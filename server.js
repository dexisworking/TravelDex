require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT) || 3000;

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_MAPS_SERVER_API_KEY =
    process.env.GOOGLE_MAPS_SERVER_API_KEY || GOOGLE_MAPS_API_KEY;
const GOOGLE_MAPS_MAP_ID = process.env.GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

const missingVars = [];
if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    missingVars.push("GEMINI_API_KEY");
}
if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY_HERE") {
    missingVars.push("GOOGLE_MAPS_API_KEY");
}

if (missingVars.length > 0) {
    console.error(
        `FATAL ERROR: Missing required environment variables: ${missingVars.join(", ")}`
    );
    console.error("Create a .env file from .env.example and add your real keys.");
    process.exit(1);
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

app.use(
    express.static(publicDir, {
        index: false,
        dotfiles: "ignore",
        maxAge: "1h",
    })
);

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function parseLatLng(value) {
    if (!value || typeof value !== "object") return null;
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
}

function sendError(res, status, message, details) {
    const payload = { error: message };
    if (details) payload.details = details;
    res.status(status).json(payload);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseUpstreamResponse(response) {
    const text = await response.text();

    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (_) {
            data = text;
        }
    }

    if (!response.ok) {
        const error = new Error(
            (data && data.error && data.error.message) ||
                (typeof data === "string" ? data : "Upstream request failed")
        );
        error.status = response.status;
        error.details = data;
        throw error;
    }

    return data;
}

async function googleJson(url, options = {}, apiKey, extraHeaders = {}) {
    const headers = { ...(options.headers || {}), ...extraHeaders };
    if (apiKey) {
        headers["X-Goog-Api-Key"] = apiKey;
    }

    const response = await fetch(url, {
        ...options,
        headers,
    });

    return parseUpstreamResponse(response);
}

function mapTravelMode(mode) {
    const value = String(mode || "DRIVING").toUpperCase();

    switch (value) {
        case "WALKING":
            return "WALK";
        case "BICYCLING":
            return "BICYCLE";
        case "TRANSIT":
            return "TRANSIT";
        case "DRIVING":
        default:
            return "DRIVE";
    }
}

function normalizePlaceApiPlace(place) {
    return {
        id: place.id,
        name: place.displayName?.text || "Unnamed place",
        formattedAddress: place.formattedAddress || "",
        shortFormattedAddress:
            place.shortFormattedAddress || place.formattedAddress || "",
        location: place.location
            ? {
                  lat: place.location.latitude,
                  lng: place.location.longitude,
              }
            : null,
        rating: place.rating ?? null,
        userRatingCount: place.userRatingCount ?? null,
        primaryType: place.primaryType || null,
        openNow:
            place.currentOpeningHours?.openNow ??
            place.regularOpeningHours?.openNow ??
            null,
        editorialSummary: place.editorialSummary?.text || "",
    };
}

app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
});

app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "traveldex",
        geminiModel: GEMINI_MODEL,
        date: new Date().toISOString(),
    });
});

app.get("/api/config", (_req, res) => {
    res.json({
        googleMapsApiKey: GOOGLE_MAPS_API_KEY,
        googleMapsFallbackApiKey:
            GOOGLE_MAPS_SERVER_API_KEY !== GOOGLE_MAPS_API_KEY
                ? GOOGLE_MAPS_SERVER_API_KEY
                : null,
        googleMapsMapId: GOOGLE_MAPS_MAP_ID,
    });
});

app.post("/api/gemini/generateContent", async (req, res) => {
    const geminiApiUrl =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(
            GEMINI_API_KEY
        )}`;

    try {
        const retryableStatuses = new Set([429, 503]);
        const maxAttempts = 3;
        let responseData = null;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const apiResponse = await fetch(geminiApiUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(req.body || {}),
                });

                responseData = await parseUpstreamResponse(apiResponse);
                lastError = null;
                break;
            } catch (error) {
                lastError = error;
                const canRetry =
                    retryableStatuses.has(error.status) && attempt < maxAttempts;
                if (!canRetry) {
                    throw error;
                }
                await wait(400 * 2 ** (attempt - 1));
            }
        }

        if (lastError) {
            throw lastError;
        }

        res.json(responseData);
    } catch (error) {
        console.error("Gemini API error:", error.details || error.message);
        sendError(
            res,
            error.status || 500,
            "Gemini request failed.",
            error.details || error.message
        );
    }
});

app.post("/api/maps/search-text", async (req, res) => {
    const query = String(req.body?.query || "").trim();
    if (!query) {
        return sendError(res, 400, "Search query is required.");
    }

    const maxResultCount = clampNumber(req.body?.maxResultCount, 1, 10, 8);
    const locationBias = parseLatLng(req.body?.locationBias);

    const body = {
        textQuery: query,
        maxResultCount,
    };

    if (locationBias) {
        body.locationBias = {
            circle: {
                center: {
                    latitude: locationBias.lat,
                    longitude: locationBias.lng,
                },
                radius: clampNumber(req.body?.biasRadius, 500, 50000, 5000),
            },
        };
    }

    try {
        const data = await googleJson(
            "https://places.googleapis.com/v1/places:searchText",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            },
            GOOGLE_MAPS_SERVER_API_KEY,
            {
                "X-Goog-FieldMask":
                    "places.id,places.displayName,places.formattedAddress," +
                    "places.shortFormattedAddress,places.location,places.rating," +
                    "places.userRatingCount,places.primaryType",
            }
        );

        res.json({
            places: (data.places || []).map(normalizePlaceApiPlace),
        });
    } catch (error) {
        console.error("Places text search error:", error.details || error.message);
        sendError(
            res,
            error.status || 500,
            "Place search failed.",
            error.details || error.message
        );
    }
});

app.post("/api/maps/nearby", async (req, res) => {
    const center = parseLatLng(req.body?.center);
    const type = String(req.body?.type || "").trim();

    if (!center) {
        return sendError(res, 400, "A valid search center is required.");
    }
    if (!type) {
        return sendError(res, 400, "A place type is required.");
    }

    const radius = clampNumber(req.body?.radius, 100, 50000, 5000);
    const maxResultCount = clampNumber(req.body?.maxResultCount, 1, 20, 12);

    try {
        const data = await googleJson(
            "https://places.googleapis.com/v1/places:searchNearby",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    includedTypes: [type],
                    maxResultCount,
                    locationRestriction: {
                        circle: {
                            center: {
                                latitude: center.lat,
                                longitude: center.lng,
                            },
                            radius,
                        },
                    },
                }),
            },
            GOOGLE_MAPS_SERVER_API_KEY,
            {
                "X-Goog-FieldMask":
                    "places.id,places.displayName,places.formattedAddress," +
                    "places.shortFormattedAddress,places.location,places.rating," +
                    "places.userRatingCount,places.primaryType",
            }
        );

        res.json({
            places: (data.places || []).map(normalizePlaceApiPlace),
        });
    } catch (error) {
        console.error("Places nearby search error:", error.details || error.message);
        sendError(
            res,
            error.status || 500,
            "Nearby search failed.",
            error.details || error.message
        );
    }
});

app.get("/api/maps/place-details/:placeId", async (req, res) => {
    const placeId = String(req.params.placeId || "").trim();
    if (!placeId) {
        return sendError(res, 400, "A place id is required.");
    }

    try {
        const place = await googleJson(
            `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
            {
                method: "GET",
            },
            GOOGLE_MAPS_SERVER_API_KEY,
            {
                "X-Goog-FieldMask":
                    "id,displayName,formattedAddress,shortFormattedAddress,location," +
                    "rating,userRatingCount,currentOpeningHours.openNow," +
                    "regularOpeningHours.openNow,editorialSummary",
            }
        );

        res.json({ place: normalizePlaceApiPlace(place) });
    } catch (error) {
        console.error("Place details error:", error.details || error.message);
        sendError(
            res,
            error.status || 500,
            "Place details lookup failed.",
            error.details || error.message
        );
    }
});

app.get("/api/maps/geocode", async (req, res) => {
    const address = String(req.query.address || "").trim();
    const lat = req.query.lat;
    const lng = req.query.lng;

    const geocodeUrl = new URL(
        "https://maps.googleapis.com/maps/api/geocode/json"
    );
    geocodeUrl.searchParams.set("key", GOOGLE_MAPS_SERVER_API_KEY);

    if (address) {
        geocodeUrl.searchParams.set("address", address);
    } else if (lat !== undefined && lng !== undefined) {
        geocodeUrl.searchParams.set("latlng", `${lat},${lng}`);
    } else {
        return sendError(
            res,
            400,
            "Provide either an address or both lat and lng query parameters."
        );
    }

    try {
        const data = await googleJson(geocodeUrl.toString(), {}, null);

        if (!Array.isArray(data.results) || data.results.length === 0) {
            return sendError(res, 404, "No geocoding results were found.");
        }

        res.json({ result: data.results[0] });
    } catch (error) {
        console.error("Geocode error:", error.details || error.message);
        sendError(
            res,
            error.status || 500,
            "Geocoding failed.",
            error.details || error.message
        );
    }
});

app.post("/api/maps/route", async (req, res) => {
    const origin = parseLatLng(req.body?.origin);
    const destination = parseLatLng(req.body?.destination);
    const intermediates = Array.isArray(req.body?.waypoints)
        ? req.body.waypoints.map(parseLatLng).filter(Boolean)
        : [];
    const optimizeWaypointOrder = Boolean(req.body?.optimizeWaypointOrder);

    if (!origin || !destination) {
        return sendError(res, 400, "Origin and destination are required.");
    }

    const body = {
        origin: {
            location: {
                latLng: {
                    latitude: origin.lat,
                    longitude: origin.lng,
                },
            },
        },
        destination: {
            location: {
                latLng: {
                    latitude: destination.lat,
                    longitude: destination.lng,
                },
            },
        },
        travelMode: mapTravelMode(req.body?.travelMode),
    };

    if (intermediates.length > 0) {
        body.intermediates = intermediates.map((waypoint) => ({
            location: {
                latLng: {
                    latitude: waypoint.lat,
                    longitude: waypoint.lng,
                },
            },
        }));
        body.optimizeWaypointOrder = optimizeWaypointOrder;
    }

    try {
        const data = await googleJson(
            "https://routes.googleapis.com/directions/v2:computeRoutes",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            },
            GOOGLE_MAPS_SERVER_API_KEY,
            {
                "X-Goog-FieldMask":
                    "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline," +
                    "routes.optimizedIntermediateWaypointIndex",
            }
        );

        const route = data.routes?.[0];
        if (!route) {
            return sendError(res, 404, "No route was returned.");
        }

        res.json({
            route: {
                distanceMeters: route.distanceMeters || 0,
                duration: route.duration || null,
                encodedPolyline: route.polyline?.encodedPolyline || "",
                optimizedIntermediateWaypointIndex:
                    route.optimizedIntermediateWaypointIndex || [],
            },
        });
    } catch (error) {
        console.error("Routes API error:", error.details || error.message);
        sendError(
            res,
            error.status || 500,
            "Route computation failed.",
            error.details || error.message
        );
    }
});

app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "ai_trip_planner.html"));
});

app.listen(port, () => {
    console.log(`TravelDex is running at http://localhost:${port}`);
    console.log(`Serving frontend from ${publicDir}`);
    console.log(`Gemini model: ${GEMINI_MODEL}`);
});

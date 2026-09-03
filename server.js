require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

/* =====================================================
   DATABASE CONNECTION
===================================================== */

let mongoConnected = false;

if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    })
    .then(() => {
      mongoConnected = true;
      console.log("MongoDB Connected Successfully");
    })
    .catch((error) => {
      console.error("MongoDB Error:", error.message);
      console.log("Server will continue without database connection.");
    });
} else {
  console.log("MONGODB_URI not found. Database disabled.");
}

/* =====================================================
   SENSOR DATABASE MODEL
===================================================== */

const sensorSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    default: "ESP32-FG-001"
  },

  area: {
    type: String,
    default: "Unknown"
  },

  waterLevel: {
    type: Number,
    default: 0
  },

  rainfall: {
    type: Number,
    default: 0
  },

  temperature: {
    type: Number,
    default: 0
  },

  humidity: {
    type: Number,
    default: 0
  },

  flowRate: {
    type: Number,
    default: 0
  },

  latitude: {
    type: Number,
    default: null
  },

  longitude: {
    type: Number,
    default: null
  },

  riskScore: {
    type: Number,
    default: 0
  },

  riskStatus: {
    type: String,
    default: "SAFE"
  },

  source: {
    type: String,
    default: "SENSOR"
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

const SensorData = mongoose.model(
  "SensorData",
  sensorSchema
);

/* =====================================================
   FLOOD RISK CALCULATION
===================================================== */

function calculateRisk(
  waterLevel = 0,
  rainfall = 0,
  flowRate = 0,
  humidity = 0
) {
  waterLevel = Number(waterLevel) || 0;
  rainfall = Number(rainfall) || 0;
  flowRate = Number(flowRate) || 0;
  humidity = Number(humidity) || 0;

  const waterScore = Math.min(
    45,
    (waterLevel / 150) * 45
  );

  const rainScore = Math.min(
    30,
    (rainfall / 100) * 30
  );

  const flowScore = Math.min(
    15,
    (flowRate / 100) * 15
  );

  const humidityScore = Math.min(
    10,
    ((humidity - 40) / 60) * 10
  );

  let score = Math.round(
    Math.max(0, waterScore) +
    Math.max(0, rainScore) +
    Math.max(0, flowScore) +
    Math.max(0, humidityScore)
  );

  score = Math.max(
    0,
    Math.min(100, score)
  );

  let status = "SAFE";

  if (score >= 85) {
    status = "CRITICAL";
  } else if (score >= 65) {
    status = "HIGH";
  } else if (score >= 35) {
    status = "WATCH";
  }

  return {
    score,
    status
  };
}

/* =====================================================
   WEATHER CODE INTERPRETER
===================================================== */

function getWeatherCondition(code) {
  const weatherCodes = {
    0: {
      condition: "Clear Sky",
      effect: "clear",
      icon: "☀️"
    },

    1: {
      condition: "Mainly Clear",
      effect: "clear",
      icon: "🌤️"
    },

    2: {
      condition: "Partly Cloudy",
      effect: "cloudy",
      icon: "⛅"
    },

    3: {
      condition: "Overcast",
      effect: "cloudy",
      icon: "☁️"
    },

    45: {
      condition: "Fog",
      effect: "fog",
      icon: "🌫️"
    },

    48: {
      condition: "Depositing Rime Fog",
      effect: "fog",
      icon: "🌫️"
    },

    51: {
      condition: "Light Drizzle",
      effect: "rain",
      icon: "🌦️"
    },

    53: {
      condition: "Moderate Drizzle",
      effect: "rain",
      icon: "🌦️"
    },

    55: {
      condition: "Heavy Drizzle",
      effect: "rain",
      icon: "🌧️"
    },

    61: {
      condition: "Slight Rain",
      effect: "rain",
      icon: "🌦️"
    },

    63: {
      condition: "Moderate Rain",
      effect: "rain",
      icon: "🌧️"
    },

    65: {
      condition: "Heavy Rain",
      effect: "heavy-rain",
      icon: "🌧️"
    },

    71: {
      condition: "Light Snow",
      effect: "snow",
      icon: "❄️"
    },

    73: {
      condition: "Moderate Snow",
      effect: "snow",
      icon: "❄️"
    },

    75: {
      condition: "Heavy Snow",
      effect: "snow",
      icon: "❄️"
    },

    80: {
      condition: "Rain Showers",
      effect: "rain",
      icon: "🌦️"
    },

    81: {
      condition: "Moderate Rain Showers",
      effect: "rain",
      icon: "🌧️"
    },

    82: {
      condition: "Violent Rain Showers",
      effect: "heavy-rain",
      icon: "⛈️"
    },

    95: {
      condition: "Thunderstorm",
      effect: "thunder",
      icon: "⛈️"
    },

    96: {
      condition: "Thunderstorm with Hail",
      effect: "thunder",
      icon: "⛈️"
    },

    99: {
      condition: "Severe Thunderstorm",
      effect: "thunder",
      icon: "⚡"
    }
  };

  return (
    weatherCodes[code] || {
      condition: "Unknown",
      effect: "clear",
      icon: "🌍"
    }
  );
}

/* =====================================================
   OPEN-METEO CITY SEARCH
===================================================== */

async function searchCity(city) {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?` +
    `name=${encodeURIComponent(city)}` +
    `&count=1` +
    `&language=en` +
    `&format=json`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      "Unable to search location"
    );
  }

  const data = await response.json();

  if (
    !data.results ||
    data.results.length === 0
  ) {
    return null;
  }

  return data.results[0];
}

/* =====================================================
   GET OPEN-METEO WEATHER
===================================================== */

async function getWeatherData(
  latitude,
  longitude
) {
  const url =
    `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${latitude}` +
    `&longitude=${longitude}` +
    `&current=temperature_2m,relative_humidity_2m,` +
    `apparent_temperature,precipitation,rain,` +
    `weather_code,wind_speed_10m` +
    `&hourly=precipitation_probability,` +
    `precipitation,rain` +
    `&daily=weather_code,temperature_2m_max,` +
    `temperature_2m_min,precipitation_sum,` +
    `rain_sum,precipitation_probability_max` +
    `&timezone=auto` +
    `&forecast_days=3`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      "Unable to fetch weather data"
    );
  }

  return await response.json();
}

/* =====================================================
   ROOT
===================================================== */

app.get("/", (req, res) => {
  res.json({
    success: true,
    platform: "FloodGuard AI",
    team: "Hexa Tech",
    status: "Backend Online",
    database: mongoConnected
      ? "Connected"
      : "Unavailable"
  });
});

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    platform: "FloodGuard AI",
    team: "Hexa Tech",
    mongodb: mongoConnected,
    timestamp: new Date()
  });
});

/* =====================================================
   LOCATION SEARCH API

   Example:
   /api/location?city=Hyderabad
===================================================== */

app.get(
  "/api/location",
  async (req, res) => {
    try {
      const city = String(
        req.query.city || ""
      ).trim();

      if (!city) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide a city name."
        });
      }

      const location =
        await searchCity(city);

      if (!location) {
        return res.status(404).json({
          success: false,
          message:
            "Location not found."
        });
      }

      res.json({
        success: true,

        location: {
          name: location.name,
          country: location.country,
          countryCode:
            location.country_code,

          state:
            location.admin1 || "",

          latitude:
            location.latitude,

          longitude:
            location.longitude,

          timezone:
            location.timezone
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/* =====================================================
   LIVE WEATHER BY CITY

   Example:
   /api/weather?city=Vijayawada
===================================================== */

app.get(
  "/api/weather",
  async (req, res) => {
    try {
      const city = String(
        req.query.city || "Vijayawada"
      ).trim();

      const location =
        await searchCity(city);

      if (!location) {
        return res.status(404).json({
          success: false,
          message:
            "City not found."
        });
      }

      const weather =
        await getWeatherData(
          location.latitude,
          location.longitude
        );

      const current =
        weather.current || {};

      const daily =
        weather.daily || {};

      const weatherInfo =
        getWeatherCondition(
          current.weather_code
        );

      const rainfall =
        Number(current.rain || 0);

      const precipitation =
        Number(
          current.precipitation || 0
        );

      const humidity =
        Number(
          current.relative_humidity_2m || 0
        );

      /*
       WEATHER FLOOD RISK ESTIMATE
      */

      let weatherRisk = 0;

      weatherRisk += Math.min(
        45,
        rainfall * 15
      );

      weatherRisk += Math.min(
        25,
        precipitation * 8
      );

      if (
        current.weather_code >= 63
      ) {
        weatherRisk += 15;
      }

      if (
        current.weather_code >= 80
      ) {
        weatherRisk += 20;
      }

      weatherRisk +=
        humidity > 85
          ? 10
          : humidity > 70
          ? 5
          : 0;

      weatherRisk = Math.min(
        100,
        Math.round(weatherRisk)
      );

      let weatherRiskStatus =
        "SAFE";

      if (weatherRisk >= 80) {
        weatherRiskStatus =
          "CRITICAL";
      } else if (weatherRisk >= 60) {
        weatherRiskStatus =
          "HIGH";
      } else if (weatherRisk >= 30) {
        weatherRiskStatus =
          "WATCH";
      }

      res.json({
        success: true,

        location: {
          name: location.name,
          country: location.country,
          state:
            location.admin1 || "",

          latitude:
            location.latitude,

          longitude:
            location.longitude,

          timezone:
            location.timezone
        },

        current: {
          temperature:
            current.temperature_2m,

          humidity:
            current.relative_humidity_2m,

          apparentTemperature:
            current.apparent_temperature,

          precipitation,

          rainfall,

          windSpeed:
            current.wind_speed_10m,

          weatherCode:
            current.weather_code,

          condition:
            weatherInfo.condition,

          icon:
            weatherInfo.icon,

          weatherEffect:
            weatherInfo.effect,

          time:
            current.time
        },

        floodRisk: {
          score: weatherRisk,

          status:
            weatherRiskStatus,

          source:
            "OPEN-METEO WEATHER ANALYSIS"
        },

        forecast: {
          dates:
            daily.time || [],

          weatherCodes:
            daily.weather_code || [],

          maxTemperature:
            daily.temperature_2m_max || [],

          minTemperature:
            daily.temperature_2m_min || [],

          precipitation:
            daily.precipitation_sum || [],

          rainfall:
            daily.rain_sum || [],

          rainProbability:
            daily.precipitation_probability_max || []
        },

        updatedAt:
          new Date()
      });

    } catch (error) {
      console.error(
        "Weather Error:",
        error.message
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to fetch live weather.",
        error: error.message
      });
    }
  }
);

/* =====================================================
   WEATHER BY LATITUDE AND LONGITUDE
===================================================== */

app.get(
  "/api/weather/coordinates",
  async (req, res) => {
    try {
      const latitude =
        Number(req.query.latitude);

      const longitude =
        Number(req.query.longitude);

      if (
        Number.isNaN(latitude) ||
        Number.isNaN(longitude)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid latitude and longitude are required."
        });
      }

      const weather =
        await getWeatherData(
          latitude,
          longitude
        );

      const current =
        weather.current || {};

      const weatherInfo =
        getWeatherCondition(
          current.weather_code
        );

      res.json({
        success: true,

        coordinates: {
          latitude,
          longitude
        },

        current: {
          temperature:
            current.temperature_2m,

          humidity:
            current.relative_humidity_2m,

          rainfall:
            current.rain,

          precipitation:
            current.precipitation,

          windSpeed:
            current.wind_speed_10m,

          weatherCode:
            current.weather_code,

          condition:
            weatherInfo.condition,

          icon:
            weatherInfo.icon,

          weatherEffect:
            weatherInfo.effect
        },

        updatedAt:
          new Date()
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =====================================================
   SAVE SENSOR DATA
===================================================== */

app.post(
  "/api/sensor",
  async (req, res) => {
    try {
      if (!mongoConnected) {
        return res.status(503).json({
          success: false,
          message:
            "MongoDB is not connected."
        });
      }

      const {
        deviceId,
        area,
        waterLevel,
        rainfall,
        temperature,
        humidity,
        flowRate,
        latitude,
        longitude
      } = req.body;

      const risk =
        calculateRisk(
          waterLevel,
          rainfall,
          flowRate,
          humidity
        );

      const sensorData =
        await SensorData.create({
          deviceId:
            deviceId ||
            "ESP32-FG-001",

          area:
            area ||
            "Unknown",

          waterLevel,
          rainfall,
          temperature,
          humidity,
          flowRate,
          latitude,
          longitude,

          riskScore:
            risk.score,

          riskStatus:
            risk.status,

          source:
            "ESP32 SENSOR"
        });

      io.emit(
        "sensorUpdate",
        sensorData
      );

      if (
        risk.status === "HIGH" ||
        risk.status === "CRITICAL"
      ) {
        io.emit(
          "emergencyAlert",
          {
            area:
              sensorData.area,

            riskScore:
              risk.score,

            riskStatus:
              risk.status,

            message:
              `FloodGuard AI detected ${risk.status} flood risk in ${sensorData.area}.`
          }
        );
      }

      res.status(201).json({
        success: true,

        message:
          "Sensor data stored successfully",

        data:
          sensorData
      });

    } catch (error) {
      console.error(
        "Sensor Error:",
        error.message
      );

      res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =====================================================
   LATEST SENSOR DATA
===================================================== */

app.get(
  "/api/sensor/latest",
  async (req, res) => {
    try {
      if (!mongoConnected) {
        return res.json({
          success: true,
          data: null,
          message:
            "Database is currently unavailable."
        });
      }

      const data =
        await SensorData
          .findOne()
          .sort({
            createdAt: -1
          });

      res.json({
        success: true,
        data
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =====================================================
   SENSOR HISTORY
===================================================== */

app.get(
  "/api/sensor/history",
  async (req, res) => {
    try {
      if (!mongoConnected) {
        return res.json({
          success: true,
          count: 0,
          data: []
        });
      }

      const limit = Math.min(
        Number(req.query.limit) || 30,
        500
      );

      const data =
        await SensorData
          .find()
          .sort({
            createdAt: -1
          })
          .limit(limit);

      res.json({
        success: true,
        count:
          data.length,
        data
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =====================================================
   GET DATA BY AREA
===================================================== */

app.get(
  "/api/area/:area",
  async (req, res) => {
    try {
      if (!mongoConnected) {
        return res.json({
          success: true,
          data: null
        });
      }

      const data =
        await SensorData
          .findOne({
            area:
              req.params.area
          })
          .sort({
            createdAt: -1
          });

      res.json({
        success: true,
        data
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =====================================================
   ALL MONITORED AREAS
===================================================== */

app.get(
  "/api/areas",
  async (req, res) => {
    try {
      if (!mongoConnected) {
        return res.json({
          success: true,
          count: 0,
          data: []
        });
      }

      const data =
        await SensorData.aggregate([
          {
            $sort: {
              createdAt: -1
            }
          },

          {
            $group: {
              _id:
                "$area",

              latest: {
                $first:
                  "$$ROOT"
              }
            }
          },

          {
            $replaceRoot: {
              newRoot:
                "$latest"
            }
          }
        ]);

      res.json({
        success: true,
        count:
          data.length,
        data
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =====================================================
   AI FLOOD PREDICTION
===================================================== */

app.post(
  "/api/predict",
  (req, res) => {
    try {
      const {
        waterLevel,
        rainfall,
        flowRate,
        humidity
      } = req.body;

      const risk =
        calculateRisk(
          waterLevel,
          rainfall,
          flowRate,
          humidity
        );

      let recommendation =
        "Conditions appear stable. Continue normal monitoring.";

      if (
        risk.status === "WATCH"
      ) {
        recommendation =
          "Increase monitoring frequency and prepare emergency response resources.";
      }

      if (
        risk.status === "HIGH"
      ) {
        recommendation =
          "Issue precautionary flood warnings and prepare evacuation plans for vulnerable areas.";
      }

      if (
        risk.status === "CRITICAL"
      ) {
        recommendation =
          "Immediate emergency response is recommended. Follow instructions from local authorities and move to safer areas if directed.";
      }

      res.json({
        success: true,

        riskScore:
          risk.score,

        prediction:
          risk.status,

        recommendation,

        analyzedData: {
          waterLevel:
            Number(
              waterLevel
            ) || 0,

          rainfall:
            Number(
              rainfall
            ) || 0,

          flowRate:
            Number(
              flowRate
            ) || 0,

          humidity:
            Number(
              humidity
            ) || 0
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =====================================================
   HEXA AI ASSISTANT
===================================================== */

app.post(
  "/api/hexa",
  async (req, res) => {
    try {
      const originalMessage =
        String(
          req.body.message || ""
        ).trim();

      if (!originalMessage) {
        return res.status(400).json({
          success: false,
          reply:
            "Please type or speak a question first."
        });
      }

      const message =
        originalMessage.toLowerCase();

      let latest = null;

      if (mongoConnected) {
        latest =
          await SensorData
            .findOne()
            .sort({
              createdAt: -1
            });
      }

      let reply =
        "I am HEXA, the FloodGuard AI assistant. I can help you with live weather, flood monitoring, locations, sensor readings, flood safety and risk analysis.";

      /* -------------------------
         GREETINGS
      ------------------------- */

      if (
        message.includes("hello") ||
        message.includes("hi ") ||
        message === "hi" ||
        message.includes("hey")
      ) {
        reply =
          "Hello! 👋 I am HEXA, your FloodGuard AI assistant. You can ask me about weather, flood risk, safety, monitored sensors, or search for a city.";
      }

      /* -------------------------
         CURRENT RISK
      ------------------------- */

      else if (
        message.includes("risk") ||
        message.includes("danger") ||
        message.includes("flood status")
      ) {
        if (latest) {
          reply =
            `The latest monitored flood risk in ${latest.area} is ${latest.riskStatus}. The current sensor-based risk score is ${latest.riskScore} out of 100.`;
        } else {
          reply =
            "No live sensor reading is currently available. You can search a city to analyze its live weather conditions.";
        }
      }

      /* -------------------------
         WATER LEVEL
      ------------------------- */

      else if (
        message.includes("water level") ||
        message.includes("water")
      ) {
        if (latest) {
          reply =
            `The latest water level in ${latest.area} is ${latest.waterLevel} cm.`;
        } else {
          reply =
            "I currently do not have a live sensor water-level reading.";
        }
      }

      /* -------------------------
         RAINFALL
      ------------------------- */

      else if (
        message.includes("rain") ||
        message.includes("rainfall")
      ) {
        if (latest) {
          reply =
            `The latest sensor rainfall reading is ${latest.rainfall} mm in ${latest.area}.`;
        } else {
          reply =
            "You can search a city in the dashboard to get live rainfall and weather information.";
        }
      }

      /* -------------------------
         TEMPERATURE
      ------------------------- */

      else if (
        message.includes("temperature")
      ) {
        if (latest) {
          reply =
            `The latest sensor temperature is ${latest.temperature}°C in ${latest.area}.`;
        } else {
          reply =
            "Please search for a city to view its live temperature.";
        }
      }

      /* -------------------------
         HUMIDITY
      ------------------------- */

      else if (
        message.includes("humidity")
      ) {
        if (latest) {
          reply =
            `The latest humidity is ${latest.humidity}% in ${latest.area}.`;
        } else {
          reply =
            "No live sensor humidity reading is currently available.";
        }
      }

      /* -------------------------
         SENSOR DATA
      ------------------------- */

      else if (
        message.includes("sensor") ||
        message.includes("reading")
      ) {
        if (latest) {
          reply =
            `Latest sensor readings from ${latest.area}: Water Level ${latest.waterLevel} cm, Rainfall ${latest.rainfall} mm, Temperature ${latest.temperature}°C, Humidity ${latest.humidity}%, and Flow Rate ${latest.flowRate}.`;
        } else {
          reply =
            "There is currently no sensor data available.";
        }
      }

      /* -------------------------
         FLOOD SAFETY
      ------------------------- */

      else if (
        message.includes("safe") ||
        message.includes("safety") ||
        message.includes("what should i do") ||
        message.includes("emergency")
      ) {
        reply =
          "Flood safety advice: stay informed through official alerts, avoid walking or driving through floodwater, move to higher ground when instructed, keep emergency supplies ready, and follow directions from local emergency authorities.";
      }

      /* -------------------------
         ALERTS
      ------------------------- */

      else if (
        message.includes("alert") ||
        message.includes("warning")
      ) {
        reply =
          "FloodGuard AI generates emergency alerts when sensor-based flood risk reaches HIGH or CRITICAL. Always verify and follow official emergency alerts from local authorities.";
      }

      /* -------------------------
         LOCATION
      ------------------------- */

      else if (
        message.includes("location") ||
        message.includes("area")
      ) {
        if (latest) {
          reply =
            `The latest monitored location is ${latest.area}.`;
        } else {
          reply =
            "You can search any city in the dashboard to get live weather and location information.";
        }
      }

      /* -------------------------
         ABOUT HEXA
      ------------------------- */

      else if (
        message.includes("who are you") ||
        message.includes("about hexa")
      ) {
        reply =
          "I am HEXA, the AI assistant of FloodGuard AI, developed for the HEXA TECH project. I help users understand weather conditions, flood monitoring data, sensor readings, risks and safety information.";
      }

      /* -------------------------
         WEATHER QUESTION
      ------------------------- */

      else if (
        message.includes("weather")
      ) {
        reply =
          "You can search any city using the location search in FloodGuard AI. I will then help you interpret temperature, rainfall, humidity and weather conditions.";
      }

      /* -------------------------
         DEFAULT RESPONSE
      ------------------------- */

      else {
        reply =
          `I received your question: "${originalMessage}". I am currently connected to FloodGuard AI's monitoring system. I can directly help with flood risk, weather, rainfall, sensors, safety and monitored locations.`;
      }

      res.json({
        success: true,
        reply,
        timestamp:
          new Date()
      });

    } catch (error) {
      console.error(
        "HEXA Error:",
        error.message
      );

      res.status(500).json({
        success: false,

        reply:
          "HEXA is temporarily unavailable. Please try again."
      });
    }
  }
);

/* =====================================================
   SOCKET.IO
===================================================== */

io.on(
  "connection",
  (socket) => {
    console.log(
      "Dashboard connected:",
      socket.id
    );

    socket.on(
      "disconnect",
      () => {
        console.log(
          "Dashboard disconnected:",
          socket.id
        );
      }
    );
  }
);

/* =====================================================
   SIMULATION MODE
===================================================== */

const SIMULATION_ENABLED =
  String(
    process.env.SIMULATION_ENABLED || "true"
  ).toLowerCase() === "true";

function generateSimulationData() {
  const waterLevel =
    Math.floor(
      Math.random() * 120
    ) + 10;

  const rainfall =
    Math.floor(
      Math.random() * 100
    );

  const temperature =
    Math.floor(
      Math.random() * 15
    ) + 20;

  const humidity =
    Math.floor(
      Math.random() * 40
    ) + 50;

  const flowRate =
    Math.floor(
      Math.random() * 80
    ) + 10;

  const risk =
    calculateRisk(
      waterLevel,
      rainfall,
      flowRate,
      humidity
    );

  const areas = [
    {
      name:
        "Vijayawada",

      latitude:
        16.5062,

      longitude:
        80.6480
    },

    {
      name:
        "Krishna River Zone",

      latitude:
        16.5185,

      longitude:
        80.6300
    },

    {
      name:
        "Prakasam Barrage",

      latitude:
        16.5089,

      longitude:
        80.6200
    },

    {
      name:
        "Flood Monitoring Zone A",

      latitude:
        16.495,

      longitude:
        80.66
    }
  ];

  const selectedArea =
    areas[
      Math.floor(
        Math.random() *
        areas.length
      )
    ];

  return {
    deviceId:
      "SIM-FG-001",

    area:
      selectedArea.name,

    waterLevel,
    rainfall,
    temperature,
    humidity,
    flowRate,

    latitude:
      selectedArea.latitude,

    longitude:
      selectedArea.longitude,

    riskScore:
      risk.score,

    riskStatus:
      risk.status,

    source:
      "SIMULATION",

    createdAt:
      new Date()
  };
}

async function runSimulation() {
  if (!SIMULATION_ENABLED) {
    return;
  }

  if (!mongoConnected) {
    return;
  }

  try {
    const simulatedData =
      generateSimulationData();

    const sensorData =
      await SensorData.create(
        simulatedData
      );

    console.log(
      "Simulation:",
      simulatedData.area,
      simulatedData.riskStatus,
      simulatedData.riskScore
    );

    io.emit(
      "sensorUpdate",
      sensorData
    );

    if (
      simulatedData.riskStatus === "HIGH" ||
      simulatedData.riskStatus === "CRITICAL"
    ) {
      io.emit(
        "emergencyAlert",
        {
          area:
            simulatedData.area,

          riskScore:
            simulatedData.riskScore,

          riskStatus:
            simulatedData.riskStatus,

          message:
            `FloodGuard AI detected ${simulatedData.riskStatus} flood risk in ${simulatedData.area}.`
        }
      );
    }

  } catch (error) {
    console.error(
      "Simulation Error:",
      error.message
    );
  }
}

/* =====================================================
   START SIMULATION
===================================================== */

if (SIMULATION_ENABLED) {
  setTimeout(
    runSimulation,
    5000
  );

  setInterval(
    runSimulation,
    15000
  );
}

/* =====================================================
   START SERVER
===================================================== */

server.listen(
  PORT,
  () => {
    console.log(
      `FloodGuard AI Backend running on port ${PORT}`
    );

    console.log(
      "Powered by HEXA TECH"
    );

    console.log(
      `Simulation Mode: ${SIMULATION_ENABLED}`
    );
  }
);
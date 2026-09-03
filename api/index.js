const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });

    isConnected = true;
    console.log("MongoDB Connected Successfully");

  } catch (error) {
    console.error("MongoDB Error:", error.message);
    throw error;
  }
}

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
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const SensorData =
  mongoose.models.SensorData ||
  mongoose.model("SensorData", sensorSchema);

function calculateRisk(waterLevel, rainfall, flowRate, humidity) {
  waterLevel = Number(waterLevel) || 0;
  rainfall = Number(rainfall) || 0;
  flowRate = Number(flowRate) || 0;
  humidity = Number(humidity) || 0;

  const waterScore = Math.min(45, waterLevel * 0.45);
  const rainScore = Math.min(30, rainfall * 0.3);
  const flowScore = Math.min(15, flowRate * 0.15);
  const humidityScore = Math.min(10, humidity * 0.1);

  let score = Math.round(
    waterScore +
    rainScore +
    flowScore +
    humidityScore
  );

  score = Math.min(100, score);

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

app.get("/api", async (req, res) => {
  try {
    await connectDB();

    res.json({
      success: true,
      platform: "FloodGuard AI",
      team: "Hexa Tech",
      status: "Backend Online"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.post("/api/sensor", async (req, res) => {
  try {
    await connectDB();

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

    const risk = calculateRisk(
      waterLevel,
      rainfall,
      flowRate,
      humidity
    );

    const sensorData = await SensorData.create({
      deviceId: deviceId || "ESP32-FG-001",
      area: area || "Unknown",
      waterLevel,
      rainfall,
      temperature,
      humidity,
      flowRate,
      latitude,
      longitude,
      riskScore: risk.score,
      riskStatus: risk.status
    });

    res.status(201).json({
      success: true,
      message: "Sensor data stored successfully",
      data: sensorData
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get("/api/sensor/latest", async (req, res) => {
  try {
    await connectDB();

    const data = await SensorData
      .findOne()
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get("/api/sensor/history", async (req, res) => {
  try {
    await connectDB();

    const limit = Math.min(
      Number(req.query.limit) || 30,
      500
    );

    const data = await SensorData
      .find()
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get("/api/area/:area", async (req, res) => {
  try {
    await connectDB();

    const data = await SensorData
      .findOne({
        area: req.params.area
      })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get("/api/areas", async (req, res) => {
  try {
    await connectDB();

    const data = await SensorData.aggregate([
      {
        $sort: {
          createdAt: -1
        }
      },
      {
        $group: {
          _id: "$area",
          latest: {
            $first: "$$ROOT"
          }
        }
      },
      {
        $replaceRoot: {
          newRoot: "$latest"
        }
      }
    ]);

    res.json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.post("/api/predict", (req, res) => {
  const {
    waterLevel,
    rainfall,
    flowRate,
    humidity
  } = req.body;

  const risk = calculateRisk(
    waterLevel,
    rainfall,
    flowRate,
    humidity
  );

  let recommendation =
    "Normal monitoring is recommended.";

  if (risk.status === "WATCH") {
    recommendation =
      "Increase monitoring frequency and prepare emergency response teams.";
  } else if (risk.status === "HIGH") {
    recommendation =
      "Issue precautionary flood warnings and prepare evacuation plans.";
  } else if (risk.status === "CRITICAL") {
    recommendation =
      "Immediate emergency response and evacuation procedures should be considered.";
  }

  res.json({
    success: true,
    riskScore: risk.score,
    prediction: risk.status,
    recommendation
  });
});

app.post("/api/hexa", async (req, res) => {
  try {
    await connectDB();

    const message = String(
      req.body.message || ""
    ).toLowerCase();

    const latest = await SensorData
      .findOne()
      .sort({ createdAt: -1 });

    let reply =
      "Hello! I'm Hexa, your FloodGuard AI assistant. Ask me about flood risk, sensors, monitoring areas, alerts or safety.";

    if (
      message.includes("risk") ||
      message.includes("danger")
    ) {
      if (latest) {
        reply =
          `Current flood risk in ${latest.area} is ${latest.riskStatus}. The AI risk score is ${latest.riskScore}/100.`;
      }
    } else if (message.includes("water")) {
      if (latest) {
        reply =
          `The latest water level is ${latest.waterLevel} cm in ${latest.area}.`;
      }
    } else if (message.includes("rain")) {
      if (latest) {
        reply =
          `Current rainfall reading is ${latest.rainfall} mm.`;
      }
    } else if (
      message.includes("sensor") ||
      message.includes("reading")
    ) {
      if (latest) {
        reply =
          `Latest readings: Water ${latest.waterLevel} cm, Rainfall ${latest.rainfall} mm, Temperature ${latest.temperature}°C, Humidity ${latest.humidity}%, Flow Rate ${latest.flowRate}.`;
      }
    } else if (
      message.includes("safe") ||
      message.includes("safety")
    ) {
      reply =
        "Flood safety advice: move to higher ground, avoid entering floodwater, keep emergency supplies ready and follow official emergency instructions.";
    } else if (message.includes("alert")) {
      reply =
        "FloodGuard AI generates emergency alerts when the flood risk reaches HIGH or CRITICAL.";
    } else if (
      message.includes("area") ||
      message.includes("location")
    ) {
      if (latest) {
        reply =
          `The latest monitored area is ${latest.area}.`;
      }
    }

    res.json({
      success: true,
      reply
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      reply:
        "Hexa AI is temporarily unavailable."
    });
  }
});

module.exports = app;

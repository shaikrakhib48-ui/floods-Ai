require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"]
  })
);

app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

/* ===============================
   MONGODB CONNECTION
================================ */

mongoose
  .connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  })
  .then(() => {
    console.log("MongoDB Connected Successfully");
  })
  .catch((error) => {
    console.error("MongoDB Error:", error.message);
  });

/* ===============================
   DATABASE MODEL
================================ */

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

  latitude: Number,
  longitude: Number,

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

const SensorData = mongoose.model(
  "SensorData",
  sensorSchema
);

/* ===============================
   FLOOD RISK CALCULATION
================================ */

function calculateRisk(
  waterLevel,
  rainfall,
  flowRate,
  humidity
) {
  waterLevel = Number(waterLevel) || 0;
  rainfall = Number(rainfall) || 0;
  flowRate = Number(flowRate) || 0;
  humidity = Number(humidity) || 0;

  const waterScore = Math.min(
    45,
    waterLevel * 0.45
  );

  const rainScore = Math.min(
    30,
    rainfall * 0.3
  );

  const flowScore = Math.min(
    15,
    flowRate * 0.15
  );

  const humidityScore = Math.min(
    10,
    humidity * 0.1
  );

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

/* ===============================
   HOME
================================ */

app.get("/", (req, res) => {
  res.json({
    success: true,
    platform: "FloodGuard AI",
    team: "Hexa Tech",
    status: "Backend Online"
  });
});

/* ===============================
   STORE SENSOR DATA
================================ */

app.post("/api/sensor", async (req, res) => {
  try {
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

    const sensorData =
      await SensorData.create({
        deviceId:
          deviceId || "ESP32-FG-001",

        area:
          area || "Unknown",

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
          risk.status
      });

    io.emit(
      "sensorUpdate",
      sensorData
    );

    res.status(201).json({
      success: true,
      data: sensorData
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ===============================
   LATEST SENSOR DATA
================================ */

app.get(
  "/api/sensor/latest",
  async (req, res) => {

    try {

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
        message: error.message
      });

    }

  }
);

/* ===============================
   SENSOR HISTORY
================================ */

app.get(
  "/api/sensor/history",
  async (req, res) => {

    try {

      const limit =
        Math.min(
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
        count: data.length,
        data
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        message: error.message
      });

    }

  }
);

/* ===============================
   AI PREDICTION
================================ */

app.post(
  "/api/predict",
  (req, res) => {

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
      "Normal monitoring is recommended.";

    if (risk.status === "WATCH") {

      recommendation =
        "Increase monitoring and prepare emergency response teams.";

    }

    if (risk.status === "HIGH") {

      recommendation =
        "Issue precautionary warnings and prepare evacuation plans.";

    }

    if (risk.status === "CRITICAL") {

      recommendation =
        "Immediate emergency response is recommended. Move people to safer areas and follow official instructions.";

    }

    res.json({
      success: true,
      riskScore:
        risk.score,

      prediction:
        risk.status,

      recommendation
    });

  }
);

/* ===============================
   HEXA AI ASSISTANT
================================ */

app.post(
  "/api/hexa",
  async (req, res) => {

    try {

      const originalMessage =
        String(
          req.body?.message || ""
        ).trim();

      const message =
        originalMessage.toLowerCase();

      if (!originalMessage) {

        return res.json({
          success: true,
          reply:
            "Please ask me a question. I am Hexa, your FloodGuard AI assistant."
        });

      }

      const latest =
        await SensorData
          .findOne()
          .sort({
            createdAt: -1
          });

      let reply;

      if (
        message.includes("hello") ||
        message.includes("hi")
      ) {

        reply =
          "Hello! I am Hexa, your FloodGuard AI assistant. I can help with flood monitoring, weather information, safety guidance, sensor readings and risk analysis.";

      }

      else if (
        message.includes("risk") ||
        message.includes("danger") ||
        message.includes("flood")
      ) {

        if (latest) {

          reply =
            `The latest monitored flood risk in ${latest.area} is ${latest.riskStatus}. The current risk score is ${latest.riskScore} out of 100.`;

        } else {

          reply =
            "I do not have sensor data yet, but you can search any location to view live weather information.";

        }

      }

      else if (
        message.includes("water")
      ) {

        reply =
          latest
            ? `The latest water level in ${latest.area} is ${latest.waterLevel} cm.`
            : "Water level data is currently unavailable.";

      }

      else if (
        message.includes("rain")
      ) {

        reply =
          latest
            ? `The latest sensor rainfall reading is ${latest.rainfall} mm.`
            : "Rainfall sensor data is currently unavailable.";

      }

      else if (
        message.includes("temperature")
      ) {

        reply =
          latest
            ? `The latest temperature in ${latest.area} is ${latest.temperature} degrees Celsius.`
            : "Temperature data is currently unavailable.";

      }

      else if (
        message.includes("humidity")
      ) {

        reply =
          latest
            ? `The latest humidity is ${latest.humidity} percent.`
            : "Humidity data is currently unavailable.";

      }

      else if (
        message.includes("sensor") ||
        message.includes("reading")
      ) {

        reply =
          latest
            ? `Latest readings from ${latest.area}: Water level ${latest.waterLevel} cm, rainfall ${latest.rainfall} mm, temperature ${latest.temperature}°C, humidity ${latest.humidity}%, and flow rate ${latest.flowRate}.`
            : "No sensor readings are currently available.";

      }

      else if (
        message.includes("safe") ||
        message.includes("safety") ||
        message.includes("emergency")
      ) {

        reply =
          "Flood safety advice: move to higher ground, avoid walking or driving through floodwater, keep emergency supplies ready, protect electrical equipment and follow official emergency instructions.";

      }

      else if (
        message.includes("who are you") ||
        message.includes("your name")
      ) {

        reply =
          "I am Hexa, the AI assistant developed for the FloodGuard AI platform by Hexa Tech.";

      }

      else {

        reply =
          `I understand your question: "${originalMessage}". Currently I am operating as the FloodGuard AI assistant. I can provide flood safety guidance, explain weather conditions, sensor monitoring and risk information.`;

      }

      res.json({
        success: true,
        reply: reply || "I am ready to help."
      });

    } catch (error) {

      console.error(
        "Hexa Error:",
        error.message
      );

      res.status(500).json({
        success: false,
        reply:
          "Hexa is temporarily unavailable. Please try again."
      });

    }

  }
);

/* ===============================
   SOCKET CONNECTION
================================ */

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

/* ===============================
   SIMULATION MODE
================================ */

let simulationActive = true;

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

  const areas = [
    {
      name: "Vijayawada",
      latitude: 16.5062,
      longitude: 80.6480
    },
    {
      name: "Krishna River Zone",
      latitude: 16.5185,
      longitude: 80.6300
    },
    {
      name: "Prakasam Barrage",
      latitude: 16.5089,
      longitude: 80.6200
    }
  ];

  const selectedArea =
    areas[
      Math.floor(
        Math.random() *
        areas.length
      )
    ];

  const risk =
    calculateRisk(
      waterLevel,
      rainfall,
      flowRate,
      humidity
    );

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

    createdAt:
      new Date()
  };
}

async function runSimulation() {

  if (!simulationActive) return;

  try {

    if (
      mongoose.connection.readyState !== 1
    ) {

      return;

    }

    const simulatedData =
      generateSimulationData();

    const sensorData =
      await SensorData.create(
        simulatedData
      );

    io.emit(
      "sensorUpdate",
      sensorData
    );

    console.log(
      "Simulation:",
      sensorData.area,
      sensorData.riskStatus
    );

  } catch (error) {

    console.error(
      "Simulation Error:",
      error.message
    );

  }

}

setInterval(
  runSimulation,
  15000
);

setTimeout(
  runSimulation,
  5000
);

/* ===============================
   START SERVER
================================ */

server.listen(
  PORT,
  () => {

    console.log(
      `FloodGuard AI Backend running on port ${PORT}`
    );

  }
);
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Build an allowlist from the Replit dev/deployment domains
function buildAllowedOrigins(): string[] {
  const origins: string[] = ["http://localhost", "http://localhost:3000", "http://localhost:18790"];
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) origins.push(`https://${devDomain}`);
  const deploymentUrl = process.env.REPLIT_DEPLOYMENT_URL;
  if (deploymentUrl) origins.push(deploymentUrl.replace(/\/$/, ""));
  return origins;
}

const allowedOrigins = buildAllowedOrigins();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    // Allow same-origin (no Origin header) or explicitly listed origins
    if (!origin || allowedOrigins.some(o => origin === o || origin.endsWith(`.${o.replace(/^https?:\/\//, "")}`))) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

export default app;

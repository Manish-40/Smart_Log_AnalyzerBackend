import { Router } from "express";
import * as ctrl from "../controllers/logs.controller.js";

const router = Router();

router.post("/logs", ctrl.postLogs);
router.get("/logs", ctrl.getLogs);
router.get("/logs/stats", ctrl.getStats);
router.get("/logs/:id", ctrl.getLogById);
router.post("/logs/:id/explain", ctrl.retryExplanation);

export default router;

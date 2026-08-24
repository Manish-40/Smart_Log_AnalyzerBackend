import { Router } from "express";
import * as ctrl from "../controllers/logs.controller.js";
import multer from 'multer';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const isCsv = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv');
    const isJson = file.mimetype === 'application/json' || file.originalname.endsWith('.json');
    const isTxt = file.mimetype === 'text/plain' || file.originalname.endsWith('.log') || file.originalname.endsWith('.txt');

    if (isCsv || isJson || isTxt) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload .csv, .json, .log, or .txt'), false);
    }
  }
});

router.post('/upload', upload.single('file'), ctrl.uploadLogs);

router.post("/logs", ctrl.postLogs);
router.get("/logs", ctrl.getLogs);
router.get("/logs/stats", ctrl.getStats);
router.get("/logs/:id", ctrl.getLogById);
router.post("/logs/:id/explain", ctrl.retryExplanation);

export default router;

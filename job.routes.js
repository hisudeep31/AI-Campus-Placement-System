import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { listJobs, getJob, applyToJob } from "../controllers/job.controller.js";

const router = Router();
router.get("/", listJobs);
router.get("/:id", getJob);
router.post("/:id/apply", authenticate, authorize("student"), applyToJob);

export default router;

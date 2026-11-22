import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { listUsers, updateUser, createUser, getActivityLogs } from "../controllers/admin.controller.js";

const router = Router();
router.use(authenticate, authorize("admin"));

router.get("/users", listUsers);
router.patch("/users/:id", updateUser);
router.post("/users", createUser);
router.get("/logs", getActivityLogs);

export default router;

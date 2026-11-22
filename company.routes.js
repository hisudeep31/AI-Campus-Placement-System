import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import {
  getMyProfile, updateCompanyProfile, createJob, getMyJobs, updateJobStatus,
  getApplicants, updateApplicationStatus, scheduleInterview, getInterviewsForApplication, submitInterviewFeedback,
} from "../controllers/company.controller.js";
import { upload } from "../utils/upload.js";
import { uploadCompanyDocument, listMyDocuments } from "../controllers/verification.controller.js";
import { getRecruiterAnalytics } from "../controllers/company.controller.js";
import { validate, createJobSchema, scheduleInterviewSchema, interviewFeedbackSchema } from "../utils/validation.js";

const router = Router();
router.use(authenticate, authorize("company"));

router.get("/me", getMyProfile);
router.put("/me", updateCompanyProfile);
router.post("/jobs", validate(createJobSchema), createJob);
router.get("/jobs", getMyJobs);
router.patch("/jobs/:jobId", updateJobStatus);
router.get("/jobs/:jobId/applicants", getApplicants);
router.patch("/applications/:applicationId", updateApplicationStatus);
router.post("/applications/:applicationId/interview", validate(scheduleInterviewSchema), scheduleInterview);
router.get("/applications/:applicationId/interviews", getInterviewsForApplication);

router.post("/interviews/:interviewId/feedback", validate(interviewFeedbackSchema), submitInterviewFeedback);

router.post("/me/documents", upload.single("document"), uploadCompanyDocument);
router.get("/me/documents", listMyDocuments);
router.get("/analytics", getRecruiterAnalytics);

export default router;

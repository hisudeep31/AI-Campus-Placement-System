import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { upload } from "../utils/upload.js";
import { validate, answerSubmissionSchema } from "../utils/validation.js";
import {
  getMyProfile, updateMyProfile, setMySkills, uploadResume, getResumeMatchForJob, getResumeHistory, getResumeImprovements, getAtsHistory, submitMockAnswer, listMockInterviews, getMockInterview, getMyReadiness, exportInterviewsIcs,
  getJobRecommendations, getSkillGap, getMyApplications, getMyInterviews, generateMockInterview,
} from "../controllers/student.controller.js";

const router = Router();
router.use(authenticate, authorize("student"));

router.get("/me", getMyProfile);
router.put("/me", updateMyProfile);
router.put("/me/skills", setMySkills);
router.post("/me/resume", upload.single("resume"), uploadResume);
router.get("/me/resumes", getResumeHistory);
router.get("/me/resume/match/:jobId", getResumeMatchForJob);
router.get("/me/resume/improve", getResumeImprovements);
router.get("/me/resume/score-history", getAtsHistory);
router.get("/me/recommendations", getJobRecommendations);
router.get("/me/skill-gap", getSkillGap);
router.get("/me/applications", getMyApplications);
router.get("/me/interviews", getMyInterviews);
router.post("/me/mock-interview", generateMockInterview);
router.get("/me/mock-interviews", listMockInterviews);
router.get("/me/readiness", getMyReadiness);
router.get("/me/interviews/calendar.ics", exportInterviewsIcs);
router.get("/me/mock-interview/:id", getMockInterview);
router.post("/me/mock-interview/:id/answers", validate(answerSubmissionSchema.pick({ question_index: true, answer_text: true })), submitMockAnswer);

export default router;

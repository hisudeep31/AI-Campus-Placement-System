
import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";

import {
  listStudents,
  listPlacedStudents,
  listDepartments,
  listCompanies,
  setApproval,
  analyticsOverview,
  analyticsDepartmentWise,
  analyticsTopRecruiters,
  exportReport,
} from "../controllers/officer.controller.js";

import {
  listVerificationQueue,
  setVerification,
} from "../controllers/verification.controller.js";

import {
  salaryAnalytics,
  yearlyAnalytics,
  statusDistribution,
  readinessAnalytics,
  exportPdfReport,
} from "../controllers/analytics.controller.js";

const router = Router();

router.use(authenticate, authorize("placement_officer", "admin"));

router.get("/students", listStudents);

// NEW: Fetch students selected by companies
router.get("/placed-students", listPlacedStudents);

router.get("/departments", listDepartments);
router.get("/companies", listCompanies);
router.patch("/approvals/:userId", setApproval);

router.get("/analytics/overview", analyticsOverview);
router.get("/analytics/department-wise", analyticsDepartmentWise);
router.get("/analytics/top-recruiters", analyticsTopRecruiters);
router.get("/reports/export", exportReport);

router.get("/verification", listVerificationQueue);
router.patch("/verification/:companyId", setVerification);

router.get("/analytics/salary", salaryAnalytics);
router.get("/analytics/yearly", yearlyAnalytics);
router.get("/analytics/status-distribution", statusDistribution);
router.get("/analytics/readiness", readinessAnalytics);
router.get("/reports/pdf", exportPdfReport);

export default router;

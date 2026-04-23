import { Router, type IRouter } from "express";
import healthRouter from "./health";
import profileRouter from "./profile";
import postingsRouter from "./postings";
import matchReportsRouter from "./matchReports";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(profileRouter);
router.use(postingsRouter);
router.use(matchReportsRouter);
router.use(dashboardRouter);

export default router;

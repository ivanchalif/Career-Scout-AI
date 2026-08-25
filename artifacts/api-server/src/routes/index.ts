import { Router, type IRouter } from "express";
import healthRouter from "./health";
import profileRouter from "./profile";
import postingsRouter from "./postings";
import matchReportsRouter from "./matchReports";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";
import gmailRouter from "./gmail";
import imapRouter from "./imap";
import filterStatsRouter from "./filterStats";
import filteredEmailsRouter from "./filteredEmails";
import emailSyncLogRouter from "./emailSyncLog";
import onlineDiscoveryRouter from "./onlineDiscovery";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(profileRouter);
router.use(postingsRouter);
router.use(matchReportsRouter);
router.use(dashboardRouter);
router.use(gmailRouter);
router.use(imapRouter);
router.use(filterStatsRouter);
router.use(filteredEmailsRouter);
router.use(emailSyncLogRouter);
router.use(onlineDiscoveryRouter);

export default router;

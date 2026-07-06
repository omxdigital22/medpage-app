import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import generateRouter from "./generate";
import topicRouter from "./topic";
import quizRouter from "./quiz";
import askRouter from "./ask";
import userdataRouter from "./userdata";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(generateRouter);
router.use(topicRouter);
router.use(quizRouter);
router.use(askRouter);
router.use(userdataRouter);

export default router;

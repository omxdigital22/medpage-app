import { Router, type IRouter } from "express";
import healthRouter from "./health";
import generateRouter from "./generate";
import quizRouter from "./quiz";
import askRouter from "./ask";

const router: IRouter = Router();

router.use(healthRouter);
router.use(generateRouter);
router.use(quizRouter);
router.use(askRouter);

export default router;

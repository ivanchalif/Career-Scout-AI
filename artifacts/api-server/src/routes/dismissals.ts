import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  db,
  jobPostingsTable,
  jobPostingFeedbackTable,
} from "@workspace/db";
import {
  DismissPostingBody,
  DismissPostingParams,
  DismissPostingResponse,
  SetDismissalReasonBody,
  SetDismissalReasonParams,
  SetDismissalReasonResponse,
  UndoPostingDismissalBody,
  UndoPostingDismissalParams,
  UndoPostingDismissalResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getPostingWithReport } from "./postings";

const router: IRouter = Router();

type FeedbackSnapshot = { kind: string; createdAt: string } | null;

function getFeedbackSnapshot(
  feedback: { kind: string; createdAt: Date } | undefined,
): FeedbackSnapshot {
  return feedback
    ? { kind: feedback.kind, createdAt: feedback.createdAt.toISOString() }
    : null;
}

router.post("/postings/:id/dismiss", requireAuth, async (req, res): Promise<void> => {
  const params = DismissPostingParams.safeParse(req.params);
  const body = DismissPostingBody.safeParse(req.body ?? {});
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [posting] = await tx
      .select()
      .from(jobPostingsTable)
      .where(and(
        eq(jobPostingsTable.id, params.data.id),
        eq(jobPostingsTable.userId, req.userId),
      ))
      .for("update");

    if (!posting) return { status: 404 as const };
    if (posting.deletedAt || posting.closedAt) return { status: 409 as const };

    const [currentFeedback] = await tx
      .select({
        kind: jobPostingFeedbackTable.kind,
        createdAt: jobPostingFeedbackTable.createdAt,
      })
      .from(jobPostingFeedbackTable)
      .where(and(
        eq(jobPostingFeedbackTable.jobPostingId, posting.id),
        eq(jobPostingFeedbackTable.userId, req.userId),
      ));

    const previousFeedback = getFeedbackSnapshot(currentFeedback);
    const undoToken = randomUUID();
    await tx
      .update(jobPostingsTable)
      .set({
        deletedAt: new Date(),
        deletedBy: "user",
        dismissalUndoToken: undoToken,
        dismissalPreviousFeedback: previousFeedback,
      })
      .where(and(
        eq(jobPostingsTable.id, posting.id),
        eq(jobPostingsTable.userId, req.userId),
      ));

    let feedback = currentFeedback ?? null;
    if (body.data.reason) {
      const [updatedFeedback] = await tx
        .insert(jobPostingFeedbackTable)
        .values({
          userId: req.userId,
          jobPostingId: posting.id,
          kind: body.data.reason,
        })
        .onConflictDoUpdate({
          target: [jobPostingFeedbackTable.userId, jobPostingFeedbackTable.jobPostingId],
          set: { kind: body.data.reason, createdAt: new Date() },
        })
        .returning({
          kind: jobPostingFeedbackTable.kind,
          createdAt: jobPostingFeedbackTable.createdAt,
        });
      feedback = updatedFeedback;
    }

    return { status: 200 as const, id: posting.id, undoToken, feedback };
  });

  if (result.status !== 200) {
    res.status(result.status).json({
      error: result.status === 404 ? "Posting not found" : "Posting is already dismissed or closed",
    });
    return;
  }

  res.json(DismissPostingResponse.parse({
    id: result.id,
    undoToken: result.undoToken,
    feedback: result.feedback,
  }));
});

router.put("/postings/:id/dismissal-reason", requireAuth, async (req, res): Promise<void> => {
  const params = SetDismissalReasonParams.safeParse(req.params);
  const body = SetDismissalReasonBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [posting] = await tx
      .select()
      .from(jobPostingsTable)
      .where(and(
        eq(jobPostingsTable.id, params.data.id),
        eq(jobPostingsTable.userId, req.userId),
      ))
      .for("update");

    if (!posting) return { status: 404 as const };
    if (!posting.deletedAt || posting.dismissalUndoToken !== body.data.undoToken) {
      return { status: 409 as const };
    }

    const [feedback] = await tx
      .insert(jobPostingFeedbackTable)
      .values({
        userId: req.userId,
        jobPostingId: posting.id,
        kind: body.data.reason,
      })
      .onConflictDoUpdate({
        target: [jobPostingFeedbackTable.userId, jobPostingFeedbackTable.jobPostingId],
        set: { kind: body.data.reason, createdAt: new Date() },
      })
      .returning({
        kind: jobPostingFeedbackTable.kind,
        createdAt: jobPostingFeedbackTable.createdAt,
      });

    return {
      status: 200 as const,
      id: posting.id,
      undoToken: body.data.undoToken,
      feedback,
    };
  });

  if (result.status !== 200) {
    res.status(result.status).json({
      error: result.status === 404 ? "Posting not found" : "Dismissal token is stale",
    });
    return;
  }

  res.json(SetDismissalReasonResponse.parse({
    id: result.id,
    undoToken: result.undoToken,
    feedback: result.feedback,
  }));
});

router.post("/postings/:id/undo-dismissal", requireAuth, async (req, res): Promise<void> => {
  const params = UndoPostingDismissalParams.safeParse(req.params);
  const body = UndoPostingDismissalBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [posting] = await tx
      .select()
      .from(jobPostingsTable)
      .where(and(
        eq(jobPostingsTable.id, params.data.id),
        eq(jobPostingsTable.userId, req.userId),
      ))
      .for("update");

    if (!posting) return { status: 404 as const };
    if (!posting.deletedAt || posting.dismissalUndoToken !== body.data.undoToken) {
      return { status: 409 as const };
    }

    const previousFeedback = posting.dismissalPreviousFeedback as FeedbackSnapshot;
    if (previousFeedback) {
      const createdAt = new Date(previousFeedback.createdAt);
      await tx
        .insert(jobPostingFeedbackTable)
        .values({
          userId: req.userId,
          jobPostingId: posting.id,
          kind: previousFeedback.kind,
          createdAt,
        })
        .onConflictDoUpdate({
          target: [jobPostingFeedbackTable.userId, jobPostingFeedbackTable.jobPostingId],
          set: { kind: previousFeedback.kind, createdAt },
        });
    } else {
      await tx
        .delete(jobPostingFeedbackTable)
        .where(and(
          eq(jobPostingFeedbackTable.jobPostingId, posting.id),
          eq(jobPostingFeedbackTable.userId, req.userId),
        ));
    }

    await tx
      .update(jobPostingsTable)
      .set({
        deletedAt: null,
        deletedBy: null,
        dismissalUndoToken: null,
        dismissalPreviousFeedback: null,
      })
      .where(and(
        eq(jobPostingsTable.id, posting.id),
        eq(jobPostingsTable.userId, req.userId),
        isNotNull(jobPostingsTable.deletedAt),
      ));

    return { status: 200 as const, postingId: posting.id };
  });

  if (result.status !== 200) {
    res.status(result.status).json({
      error: result.status === 404 ? "Posting not found" : "Dismissal token is stale",
    });
    return;
  }

  const postingWithReport = await getPostingWithReport(result.postingId, req.userId);
  if (!postingWithReport) {
    res.status(404).json({ error: "Posting not found" });
    return;
  }
  res.json(UndoPostingDismissalResponse.parse(postingWithReport));
});

export default router;
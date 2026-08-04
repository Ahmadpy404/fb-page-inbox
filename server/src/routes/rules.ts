import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';

const router = Router();

const ruleSchema = z.object({
  keyword: z.string().min(1, 'Keyword is required'),
  matchType: z.enum(['exact', 'contains', 'regex']),
  replyText: z.string().min(1, 'Reply text is required'),
  priority: z.coerce.number().int().default(0),
  enabled: z.boolean().default(true),
});

/**
 * GET /api/rules
 * List all auto-reply rules.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rules = await prisma.rule.findMany({
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return res.json({ rules });
  } catch (err: any) {
    console.error('[API] Error fetching rules:', err);
    return res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

/**
 * POST /api/rules
 * Create a new rule.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    // If regex, validate regex pattern syntax
    if (parsed.data.matchType === 'regex') {
      try {
        new RegExp(parsed.data.keyword.trim());
      } catch (err) {
        return res.status(400).json({ error: 'Invalid regular expression syntax' });
      }
    }

    const rule = await prisma.rule.create({
      data: parsed.data,
    });

    return res.status(201).json({ rule });
  } catch (err: any) {
    console.error('[API] Error creating rule:', err);
    return res.status(500).json({ error: err.message || 'Failed to create rule' });
  }
});

/**
 * PUT /api/rules/:id
 * Update an existing rule.
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = ruleSchema.partial().safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    if (parsed.data.matchType === 'regex' || (parsed.data.keyword && !parsed.data.matchType)) {
      const keywordToCheck = parsed.data.keyword;
      if (keywordToCheck) {
        try {
          new RegExp(keywordToCheck.trim());
        } catch (err) {
          return res.status(400).json({ error: 'Invalid regular expression syntax' });
        }
      }
    }

    const rule = await prisma.rule.update({
      where: { id },
      data: parsed.data,
    });

    return res.json({ rule });
  } catch (err: any) {
    console.error('[API] Error updating rule:', err);
    return res.status(500).json({ error: err.message || 'Failed to update rule' });
  }
});

/**
 * DELETE /api/rules/:id
 * Delete a rule.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.rule.delete({
      where: { id },
    });
    return res.json({ success: true, message: 'Rule deleted' });
  } catch (err: any) {
    console.error('[API] Error deleting rule:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete rule' });
  }
});

/**
 * POST /api/rules/reorder
 * Bulk reorder rule priorities.
 */
router.post('/reorder', async (req: Request, res: Response) => {
  try {
    const { ruleIds } = req.body;
    if (!Array.isArray(ruleIds)) {
      return res.status(400).json({ error: 'ruleIds array is required' });
    }

    // Update each rule's priority to its array index
    const updatePromises = ruleIds.map((id, index) =>
      prisma.rule.update({
        where: { id },
        data: { priority: index },
      })
    );

    await Promise.all(updatePromises);

    const updatedRules = await prisma.rule.findMany({
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    return res.json({ rules: updatedRules });
  } catch (err: any) {
    console.error('[API] Error reordering rules:', err);
    return res.status(500).json({ error: err.message || 'Failed to reorder rules' });
  }
});

export default router;

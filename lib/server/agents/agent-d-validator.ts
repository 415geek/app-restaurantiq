import type {
  AgentBAnalysisResult,
  AgentCPlanTask,
  AgentCPlannerResult,
  AgentDValidatorResult,
  AgentOutput,
  FrontendReadyAnalysis,
} from '@/lib/types';
import { runOpenAIJsonSchema } from '@/lib/server/openai-json';

const VALID_COLUMNS = ['Backlog', 'Next 7 Days', 'In Progress', 'Blocked', 'Done'] as const;
type ValidColumn = (typeof VALID_COLUMNS)[number];
const VALID_PRIORITIES = ['P0', 'P1', 'P2'] as const;
type ValidPriority = (typeof VALID_PRIORITIES)[number];
const VALID_REQUEST_PRIORITIES = ['P0', 'P1'] as const;
type ValidRequestPriority = (typeof VALID_REQUEST_PRIORITIES)[number];

function sanitizeText(value: string | null | undefined) {
  if (!value) return '';
  return value.replace(/\.\.\./g, '').replace(/\s+/g, ' ').trim();
}

function fallbackZh(value: string, zh?: string) {
  return sanitizeText(zh) || sanitizeText(value);
}

function normalizeColumn(value: string | null | undefined): ValidColumn {
  return VALID_COLUMNS.includes(value as ValidColumn) ? (value as ValidColumn) : 'Backlog';
}

function normalizePriority(value: string | null | undefined): ValidPriority {
  return VALID_PRIORITIES.includes(value as ValidPriority) ? (value as ValidPriority) : 'P1';
}

function normalizeRequestPriority(value: string | null | undefined): ValidRequestPriority {
  return VALID_REQUEST_PRIORITIES.includes(value as ValidRequestPriority) ? (value as ValidRequestPriority) : 'P1';
}

function urgencyFromTask(task: AgentCPlanTask) {
  if (task.timeframe_days <= 3 || task.priority === 'P0') {
    return { urgency: '3 days', urgency_zh: '3天内' };
  }
  if (task.timeframe_days <= 7) {
    return { urgency: 'This week', urgency_zh: '本周' };
  }
  return { urgency: 'Next 2 weeks', urgency_zh: '未来两周' };
}

function impactFromTask(task: AgentCPlanTask) {
  if (task.priority === 'P0') {
    return {
      impact: 'High impact on margin and demand quality.',
      impact_zh: '对利润和需求质量影响高。',
    };
  }
  if (task.priority === 'P1') {
    return {
      impact: 'Meaningful upside on basket size or channel mix.',
      impact_zh: '对客单价或渠道结构有明确提升空间。',
    };
  }
  return {
    impact: 'Improves operating discipline and data reliability.',
    impact_zh: '改善运营纪律和数据可靠性。',
  };
}

function createFallbackTask(index: number): AgentCPlanTask {
  const id = `T-00${index}`;
  return {
    task_id: id,
    title: `Operational follow-up ${index}`,
    title_zh: `运营跟进事项 ${index}`,
    module: 'Ops',
    priority: 'P1',
    status_column: 'Backlog',
    owners: ['manager'],
    platforms: ['all_channels'],
    goal: 'Close a remaining analysis gap before execution.',
    goal_zh: '在执行前补齐剩余分析缺口。',
    why_now: 'The upstream plan returned too few executable tasks.',
    why_now_zh: '上游计划输出的可执行任务数量不足。',
    steps: [{ action: 'Review missing data and define next action.', action_zh: '复核缺失数据并定义下一步动作。' }],
    checklist: [{ item: 'Assign owner', item_zh: '指定负责人', done: false }],
    timeframe_days: 7,
    measurement: {
      metric: 'Task completion',
      metric_zh: '任务完成率',
      method: 'Track completion in weekly review.',
      method_zh: '在周度复盘中跟踪完成情况。',
    },
    stop_loss: {
      trigger: 'Task remains blocked for more than 7 days.',
      trigger_zh: '任务阻塞超过 7 天。',
      rollback: ['Escalate to manual review.'],
    },
    done_criteria: ['Task owner assigned.'],
    done_criteria_zh: ['已指定任务负责人。'],
  };
}

function normalizeTask(task: AgentCPlanTask): AgentCPlanTask {
  return {
    ...task,
    title: sanitizeText(task.title),
    title_zh: fallbackZh(task.title, task.title_zh),
    module: task.module,
    priority: normalizePriority(task.priority),
    status_column: normalizeColumn(task.status_column),
    goal: sanitizeText(task.goal),
    goal_zh: fallbackZh(task.goal, task.goal_zh),
    why_now: sanitizeText(task.why_now),
    why_now_zh: fallbackZh(task.why_now, task.why_now_zh),
    steps: (task.steps ?? []).map((step) => ({
      action: sanitizeText(step.action),
      action_zh: fallbackZh(step.action, step.action_zh),
    })),
    checklist: (task.checklist ?? []).map((item) => ({
      item: sanitizeText(item.item),
      item_zh: fallbackZh(item.item, item.item_zh),
      done: Boolean(item.done),
    })),
    measurement: {
      metric: sanitizeText(task.measurement.metric),
      metric_zh: fallbackZh(task.measurement.metric, task.measurement.metric_zh),
      method: sanitizeText(task.measurement.method),
      method_zh: fallbackZh(task.measurement.method, task.measurement.method_zh),
    },
    stop_loss: {
      trigger: sanitizeText(task.stop_loss.trigger),
      trigger_zh: fallbackZh(task.stop_loss.trigger, task.stop_loss.trigger_zh),
      rollback: (task.stop_loss.rollback ?? []).map((item) => sanitizeText(item)).filter(Boolean),
    },
    done_criteria: (task.done_criteria ?? []).map((item) => sanitizeText(item)).filter(Boolean),
    done_criteria_zh: (task.done_criteria_zh ?? []).map((item, index) => fallbackZh(task.done_criteria?.[index] ?? item, item)).filter(Boolean),
  };
}

function buildHealthBadge(summary: AgentBAnalysisResult['analysis']['summary']): FrontendReadyAnalysis['health_badge'] {
  const color =
    summary.health_score >= 80
      ? 'green'
      : summary.health_score >= 70
        ? 'yellow'
        : summary.health_score >= 60
          ? 'orange'
          : 'red';
  const labelMap = {
    A: { en: 'Excellent', zh: '优秀' },
    B: { en: 'Good', zh: '良好' },
    C: { en: 'Fair', zh: '一般' },
    D: { en: 'Poor', zh: '较差' },
    F: { en: 'Critical', zh: '危险' },
  } as const;
  const label = labelMap[summary.health_grade];
  return {
    score: summary.health_score,
    grade: summary.health_grade,
    grade_zh: summary.health_grade_zh,
    color,
    label: label.en,
    label_zh: label.zh,
  };
}

function buildFrontendReady(
  analyzed: AgentBAnalysisResult['analysis'],
  validatedPlan: AgentCPlannerResult['plan']
): FrontendReadyAnalysis {
  const tasks = validatedPlan.task_board.tasks;
  const sortedTasks = [...tasks].sort((left, right) => {
    const priorityOrder = { P0: 0, P1: 1, P2: 2 } as const;
    return priorityOrder[left.priority] - priorityOrder[right.priority] || left.timeframe_days - right.timeframe_days;
  });
  const topActions = sortedTasks.slice(0, 3).map((task, index) => ({
    rank: index + 1,
    task_id: task.task_id,
    title: task.title,
    title_zh: task.title_zh,
    ...urgencyFromTask(task),
    ...impactFromTask(task),
  }));
  const p0 = tasks.filter((task) => task.priority === 'P0').length;
  const p1 = tasks.filter((task) => task.priority === 'P1').length;
  const p2 = tasks.filter((task) => task.priority === 'P2').length;

  return {
    display_mode: 'full',
    health_badge: buildHealthBadge(analyzed.summary),
    kpi_cards: [
      {
        id: 'discount_rate',
        title: 'Discount Rate',
        title_zh: '折扣率',
        value: analyzed.kpis.discount_rate.formatted,
        status: analyzed.kpis.discount_rate.status,
        target: '≤20%',
        target_zh: '≤20%',
      },
      {
        id: 'aov',
        title: 'Avg Order Value',
        title_zh: '客单价',
        value: analyzed.kpis.aov.formatted,
        status: analyzed.kpis.aov.status,
        target: '$35+',
        target_zh: '$35+',
      },
      {
        id: 'orders',
        title: 'Orders/Day',
        title_zh: '日订单量',
        value: String(analyzed.kpis.orders.per_day),
        status: analyzed.kpis.orders.status,
        target: '30+',
        target_zh: '30+',
      },
      {
        id: 'health',
        title: 'Health Score',
        title_zh: '健康评分',
        value: String(analyzed.summary.health_score),
        status:
          analyzed.summary.health_score >= 80
            ? 'healthy'
            : analyzed.summary.health_score >= 70
              ? 'warning'
              : 'critical',
        target: '80+',
        target_zh: '80+',
      },
    ],
    top_actions: topActions,
    timeline: {
      week_1: {
        label: 'Week 1: Foundation',
        label_zh: '第1周：基础工作',
        tasks: tasks.slice(0, 4).map((task) => task.task_id),
      },
      week_2: {
        label: 'Week 2: Optimization',
        label_zh: '第2周：优化提升',
        tasks: tasks.slice(4, 8).map((task) => task.task_id),
      },
    },
    quick_stats: {
      total_tasks: tasks.length,
      p0_tasks: p0,
      p1_tasks: p1,
      p2_tasks: p2,
      estimated_days: Math.max(...tasks.map((task) => task.timeframe_days), 14),
      potential_impact: analyzed.summary.top_opportunity,
      potential_impact_zh: analyzed.summary.top_opportunity_zh,
    },
    platform_summary: analyzed.platform_analysis.platforms.map((platform) => ({
      name: platform.name,
      orders: platform.orders,
      revenue: platform.revenue,
      share: `${platform.share_pct.toFixed(1)}%`,
      aov: platform.aov,
      status:
        platform.share_pct >= 40
          ? 'healthy'
          : platform.share_pct >= 20
            ? 'warning'
            : 'critical',
    })),
  };
}

function buildQaStatus(taskCount: number, fixesApplied: string[], warnings: string[]) {
  if (taskCount < 6) return 'incomplete' as const;
  if (warnings.length > 0 && fixesApplied.length > 0) return 'pass_with_fixes' as const;
  if (fixesApplied.length > 0) return 'pass_with_fixes' as const;
  return 'pass' as const;
}

async function maybeEnrichValidator(
  analyzed: AgentBAnalysisResult['analysis'],
  draft: AgentDValidatorResult
): Promise<Pick<AgentDValidatorResult['frontend_ready']['quick_stats'], 'potential_impact' | 'potential_impact_zh'> | null> {
  return runOpenAIJsonSchema<Pick<AgentDValidatorResult['frontend_ready']['quick_stats'], 'potential_impact' | 'potential_impact_zh'>>({
    model: process.env.OPENAI_VALIDATOR_MODEL || 'gpt-4o',
    temperature: 0,
    maxOutputTokens: 400,
    prompt: [
      'You are Agent D, the Validator for RestaurantIQ.',
      'Refine the business impact statement only. Do not change structure or metrics.',
      JSON.stringify({
        top_issue: analyzed.summary.top_issue,
        top_opportunity: analyzed.summary.top_opportunity,
        quick_stats: draft.frontend_ready.quick_stats,
      }),
    ].join('\n'),
    schemaName: 'agent_d_impact_enrichment',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['potential_impact', 'potential_impact_zh'],
      properties: {
        potential_impact: { type: 'string' },
        potential_impact_zh: { type: 'string' },
      },
    },
  });
}

export async function runAgentDValidator(input: {
  analyzed: AgentBAnalysisResult;
  planned: AgentCPlannerResult;
}): Promise<{
  validated: AgentDValidatorResult;
  output: AgentOutput;
}> {
  const fixesApplied: string[] = [];
  const warnings: string[] = [];

  let tasks = (input.planned.plan.task_board.tasks ?? []).map(normalizeTask);
  const originalTaskCount = tasks.length;
  if (originalTaskCount > 8) {
    tasks = tasks.slice(0, 8);
    fixesApplied.push('Task count exceeded 8 and was truncated to the first 8 tasks.');
  }
  if (tasks.length < 6) {
    warnings.push('Task count is below the minimum recommended range (6-8).');
    while (tasks.length < 6) {
      tasks.push(createFallbackTask(tasks.length + 1));
      fixesApplied.push(`Added fallback task T-00${tasks.length} to meet minimum task coverage.`);
    }
  }

  const experiments = [...(input.planned.plan.experiments ?? [])].slice(0, 3).map((experiment, index) => ({
    ...experiment,
    name: sanitizeText(experiment.name) || `Experiment ${index + 1}`,
    name_zh: fallbackZh(experiment.name || `Experiment ${index + 1}`, experiment.name_zh),
    hypothesis: sanitizeText(experiment.hypothesis),
    hypothesis_zh: fallbackZh(experiment.hypothesis, experiment.hypothesis_zh),
    success_criteria: sanitizeText(experiment.success_criteria),
    success_criteria_zh: fallbackZh(experiment.success_criteria, experiment.success_criteria_zh),
  }));
  if (experiments.length < 2) {
    warnings.push('Experiment count is below the recommended range (2-3).');
  }

  const dataRequests = [...(input.planned.plan.data_requests ?? [])].slice(0, 6).map((request) => ({
    ...request,
    question: sanitizeText(request.question),
    question_zh: fallbackZh(request.question, request.question_zh),
    priority: normalizeRequestPriority(request.priority),
    source: sanitizeText(request.source),
  }));
  if (dataRequests.length < 4) {
    warnings.push('Data request count is below the recommended range (4-6).');
  }

  const validatedPlan: AgentDValidatorResult['validated_plan'] = {
    north_star: {
      ...input.planned.plan.north_star,
      objective: sanitizeText(input.planned.plan.north_star.objective),
      objective_zh: fallbackZh(input.planned.plan.north_star.objective, input.planned.plan.north_star.objective_zh),
      review_cadence: sanitizeText(input.planned.plan.north_star.review_cadence),
      review_cadence_zh: fallbackZh(input.planned.plan.north_star.review_cadence, input.planned.plan.north_star.review_cadence_zh),
    },
    task_board: {
      columns: [...VALID_COLUMNS],
      tasks,
    },
    experiments,
    data_requests: dataRequests,
    assumptions: (input.planned.plan.assumptions ?? []).map((item) => ({
      en: sanitizeText(item.en),
      zh: fallbackZh(item.en, item.zh),
    })),
    release_notes: {
      summary: sanitizeText(input.planned.plan.release_notes.summary),
      summary_zh: fallbackZh(input.planned.plan.release_notes.summary, input.planned.plan.release_notes.summary_zh),
      internal: sanitizeText(input.planned.plan.release_notes.internal),
    },
  };

  const draft: AgentDValidatorResult = {
    validated_plan: validatedPlan,
    qa_report: {
      status: buildQaStatus(tasks.length, fixesApplied, warnings),
      completeness_score: Math.max(0, Math.min(100, 70 + Math.min(20, input.analyzed.qa.data_completeness / 2) + (tasks.length >= 8 ? 10 : 0))),
      task_count: tasks.length,
      fixes_applied: fixesApplied,
      warnings,
    },
    frontend_ready: buildFrontendReady(input.analyzed.analysis, validatedPlan),
  };

  const enriched = await maybeEnrichValidator(input.analyzed.analysis, draft);
  const validated = enriched
    ? {
        ...draft,
        frontend_ready: {
          ...draft.frontend_ready,
          quick_stats: {
            ...draft.frontend_ready.quick_stats,
            ...enriched,
          },
        },
      }
    : draft;

  return {
    validated,
    output: {
      agent: 'D',
      title: 'Output Validator',
      summary: `${validated.qa_report.task_count} validated tasks ready for frontend delivery with ${validated.qa_report.status}.`,
      structuredPayload: validated,
      evidenceRefs: [],
      confidence: Math.max(0.72, validated.qa_report.completeness_score / 100),
      warnings: validated.qa_report.warnings.length ? validated.qa_report.warnings : undefined,
    },
  };
}

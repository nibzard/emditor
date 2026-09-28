// ABOUTME: Semantic writing rules, which Jev (TypeSafe) checks: the rule model, presets, versions, and thresholds.
// ABOUTME: A rule is a yes/no question about a sentence, passage, or section, with criteria and examples.

import { hash64 } from './hash'
import type { LintRules } from './lint'

export type SemanticScope = 'sentence' | 'passage' | 'section'
/** How readily a rule shows a finding. It does not change what the rule means. */
export type Sensitivity = 'gentle' | 'normal' | 'strict'

export interface RuleExample {
  text: string
  /** true: this should be flagged. false: this should be allowed. */
  flag: boolean
}

export interface SemanticRule {
  id: string
  enabled: boolean
  sensitivity: Sensitivity
  name: string
  scope: SemanticScope
  /** The yes/no question that Jev answers about the target. */
  question: string
  flagWhen: string
  allowWhen: string
  /** How to treat quotes, parody, and other edge cases. */
  boundaryCases: string
  examples: RuleExample[]
  /** The text of the finding card. */
  explanation: string
  /** The probability at or above which a finding shows, at normal sensitivity. */
  threshold: number
}

export const SCOPES: SemanticScope[] = ['sentence', 'passage', 'section']
export const SENSITIVITIES: Sensitivity[] = ['gentle', 'normal', 'strict']
export const DEFAULT_THRESHOLD = 0.85
const SENSITIVITY_OFFSET: Record<Sensitivity, number> = { gentle: 0.07, normal: 0, strict: -0.15 }

/** Starting rules from jevditor. Their wording and thresholds are not tuned; each check costs a request, so they start off. */
export const SEMANTIC_PRESETS: SemanticRule[] = [
  {
    id: 'linkedin-voice',
    enabled: false,
    sensitivity: 'normal',
    name: 'Avoid LinkedIn voice',
    scope: 'passage',
    question:
      'Does target use performative professional self-branding, turn an ordinary experience into a contrived business lesson, or use engagement-bait framing?',
    flagWhen:
      "The writing performs professional identity for an audience: an everyday event recast as a leadership or career lesson, a humblebrag, a listicle promise such as 'five lessons every founder needs to hear', or a hook designed to provoke engagement rather than inform.",
    allowWhen:
      "The writing plainly describes a job, an achievement, a professional experience, or real enthusiasm without dressing it up as a lesson or a hook. Words like 'founder', 'leadership', or 'excited' alone are not a reason to flag.",
    boundaryCases: 'Quoted examples of this style, and deliberate parody that the surrounding context makes obvious, should be allowed.',
    examples: [
      {
        text: 'I missed my train this morning.\n\nIt taught me more about leadership than ten years in management.\n\nHere are five lessons every founder needs to hear.',
        flag: true,
      },
      { text: "Humbled and honored to announce that I've been named one of the top voices in fintech. Agree?", flag: true },
      { text: "I'm starting a new job at Acme next month as a data engineer. I'll be working on their billing pipeline.", flag: false },
      { text: "Our team shipped the migration on Friday. It took four months and two false starts, and I'm glad it's done.", flag: false },
    ],
    explanation: 'This passage may match your rule about LinkedIn-style framing.',
    threshold: DEFAULT_THRESHOLD,
  },
  {
    id: 'marketing-copy',
    enabled: false,
    sensitivity: 'normal',
    name: 'Not marketing copy',
    scope: 'sentence',
    question: 'Does target read like marketing or advertising copy rather than plain description?',
    flagWhen:
      "Hype and superlatives without support ('revolutionary', 'best-in-class', 'seamless'), benefit claims with no specifics, or sales language that addresses the reader as a prospect.",
    allowWhen: 'Plain statements of what something does, including positive ones, especially when they are specific or measurable.',
    boundaryCases: 'Quoted marketing copy that the writer is discussing should be allowed.',
    examples: [
      { text: 'Our revolutionary platform seamlessly empowers teams to unlock their full potential.', flag: true },
      { text: 'The new cache cut median page load from 900 ms to 300 ms.', flag: false },
    ],
    explanation: 'This sentence may read like marketing copy.',
    threshold: DEFAULT_THRESHOLD,
  },
  {
    id: 'vague-claims',
    enabled: false,
    sensitivity: 'normal',
    name: 'Concrete over vague',
    scope: 'sentence',
    question: 'Does target make a vague or abstract claim that says little, where a concrete statement was possible?',
    flagWhen:
      "The sentence gestures at significance without content: 'This changes everything', 'There are many factors to consider', 'It plays a key role in various ways'.",
    allowWhen:
      'The sentence states something specific, or is a deliberate summary or transition whose specifics appear in the surrounding context.',
    boundaryCases: '',
    examples: [
      { text: 'There are a lot of different factors that play a role in this.', flag: true },
      { text: 'Two things drove the delay: the vendor shipped late, and we underestimated testing.', flag: false },
    ],
    explanation: 'This sentence may make a claim without saying anything concrete.',
    threshold: DEFAULT_THRESHOLD,
  },
  {
    id: 'repeated-explanation',
    enabled: false,
    sensitivity: 'normal',
    name: "Don't explain it twice",
    scope: 'section',
    question: 'Does target explain the same point more than once in different words, without adding anything the second time?',
    flagWhen: 'Two or more paragraphs make the same point, and the later one adds no new information, example, or nuance.',
    allowWhen:
      'Points are related but distinct, a later paragraph adds evidence or detail, or a brief closing summary is clearly signposted.',
    boundaryCases: '',
    examples: [],
    explanation: 'This section may explain the same point more than once.',
    threshold: DEFAULT_THRESHOLD,
  },
]

/** The parts of a rule that Jev sees. A change to them makes a new version. */
export type RuleDefinition = Omit<SemanticRule, 'id' | 'enabled' | 'sensitivity' | 'explanation' | 'threshold'>

export function definitionOf(rule: SemanticRule): RuleDefinition {
  const { name, scope, question, flagWhen, allowWhen, boundaryCases, examples } = rule
  return { name, scope, question, flagWhen, allowWhen, boundaryCases, examples }
}

/**
 * The version of a rule: a hash of what Jev sees. Old results do not match a new version.
 * `enabled`, `sensitivity`, `explanation`, and `threshold` only change what shows, so they are not in it.
 */
export function ruleVersion(rule: SemanticRule): string {
  return hash64(JSON.stringify(definitionOf(rule)))
}

/** The probability at or above which a finding of the rule shows. */
export function effectiveThreshold(rule: Pick<SemanticRule, 'threshold' | 'sensitivity'>): number {
  return Math.min(0.99, Math.max(0.5, rule.threshold + SENSITIVITY_OFFSET[rule.sensitivity]))
}

/** The key of a semantic rule in the kept list. */
export const keptRule = (id: string) => `semantic:${id}`

/** Gives rules where the rule has the text as an allow example. This makes a new version of the rule. */
export function allowExample(rules: LintRules, id: string, text: string): LintRules {
  return {
    ...rules,
    semantic: rules.semantic.map((r) =>
      r.id !== id || r.examples.some((e) => e.text === text && !e.flag) ? r : { ...r, examples: [...r.examples, { text, flag: false }] },
    ),
  }
}

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

/** Reads the semantic list of a rules file. A missing list gives the presets; bad entries and repeated ids are dropped. */
export function parseSemantic(value: unknown): SemanticRule[] {
  if (!Array.isArray(value)) return SEMANTIC_PRESETS
  const seen = new Set<string>()
  const out: SemanticRule[] = []
  for (const item of value) {
    const r = item as Record<string, unknown>
    if (typeof r !== 'object' || r === null || typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue
    if (!SCOPES.includes(r.scope as SemanticScope) || typeof r.name !== 'string' || typeof r.question !== 'string') continue
    seen.add(r.id)
    const threshold = r.threshold
    out.push({
      id: r.id,
      enabled: r.enabled === true,
      sensitivity: SENSITIVITIES.includes(r.sensitivity as Sensitivity) ? (r.sensitivity as Sensitivity) : 'normal',
      name: r.name,
      scope: r.scope as SemanticScope,
      question: r.question,
      flagWhen: str(r.flagWhen),
      allowWhen: str(r.allowWhen),
      boundaryCases: str(r.boundaryCases),
      examples: Array.isArray(r.examples)
        ? r.examples
            .filter((e): e is RuleExample => typeof e?.text === 'string' && typeof e?.flag === 'boolean')
            .map(({ text, flag }) => ({ text, flag }))
        : [],
      explanation: str(r.explanation),
      threshold: typeof threshold === 'number' && threshold > 0 && threshold < 1 ? threshold : DEFAULT_THRESHOLD,
    })
  }
  return out
}

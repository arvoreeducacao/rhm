import { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";

interface EvalQuery {
  query: string;
  should_trigger: boolean;
}

interface EvalResult {
  query: string;
  should_trigger: boolean;
  triggered: boolean;
  pass: boolean;
}

interface IterationResult {
  iteration: number;
  description: string;
  triggers: string[];
  results: EvalResult[];
  passed: number;
  failed: number;
  total: number;
}

interface SkillMeta {
  name: string;
  description: string;
  triggers: string[];
  body: string;
}

function parseSkillMd(content: string): SkillMeta {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    return { name: "", description: "", triggers: [], body: content };
  }

  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const triggersMatch = frontmatter.match(/^triggers:\s*\[([^\]]*)\]$/m);

  const triggers = triggersMatch
    ? triggersMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    name: nameMatch?.[1]?.trim() || "",
    description: descMatch?.[1]?.trim() || "",
    triggers,
    body,
  };
}

function rebuildSkillMd(
  originalContent: string,
  newDescription: string,
  newTriggers: string[]
): string {
  const fmMatch = originalContent.match(
    /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
  );
  if (!fmMatch) return originalContent;

  let frontmatter = fmMatch[1];
  const body = fmMatch[2];

  frontmatter = frontmatter.replace(
    /^description:\s*.+$/m,
    `description: ${newDescription}`
  );

  const triggersLine = `triggers: [${newTriggers.join(", ")}]`;
  if (frontmatter.match(/^triggers:/m)) {
    frontmatter = frontmatter.replace(/^triggers:\s*\[.*\]$/m, triggersLine);
  } else {
    frontmatter += `\n${triggersLine}`;
  }

  return `---\n${frontmatter}\n---\n${body}`;
}

async function callLLM(
  prompt: string,
  opts: { apiKey: string; model: string; baseUrl: string }
): Promise<string> {
  const response = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0].message.content;
}

async function generateEvalQueries(
  skill: SkillMeta,
  allSkills: SkillMeta[],
  llmOpts: { apiKey: string; model: string; baseUrl: string }
): Promise<EvalQuery[]> {
  const otherSkills = allSkills
    .filter((s) => s.name !== skill.name)
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  const prompt = `You are generating test queries to evaluate whether an AI skill's description and triggers correctly cause it to be selected.

Skill being tested:
- Name: ${skill.name}
- Description: ${skill.description}
- Triggers: [${skill.triggers.join(", ")}]

Other skills in the workspace (for context on what should NOT trigger this skill):
${otherSkills || "(none)"}

Generate exactly 16 test queries as a JSON array. Each query should be a realistic user request — specific, with context, like a real developer would type.

Rules:
- 8 queries that SHOULD trigger this skill (should_trigger: true)
  - Include edge cases: indirect references, casual phrasing, abbreviations
  - Don't just repeat the trigger words — test semantic understanding
- 8 queries that should NOT trigger this skill (should_trigger: false)
  - Focus on near-misses: queries that share keywords but need a different skill
  - Include queries for adjacent domains that could be confused
  - Don't make them obviously irrelevant

Respond with ONLY a JSON array, no markdown fences:
[{"query": "...", "should_trigger": true}, ...]`;

  const response = await callLLM(prompt, llmOpts);
  const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    return JSON.parse(cleaned) as EvalQuery[];
  } catch {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]) as EvalQuery[];
    }
    throw new Error("Failed to parse eval queries from LLM response");
  }
}

async function simulateTriggering(
  query: string,
  targetSkill: SkillMeta,
  allSkills: SkillMeta[],
  llmOpts: { apiKey: string; model: string; baseUrl: string }
): Promise<boolean> {
  const skillsList = allSkills
    .map(
      (s) =>
        `- ${s.name}: ${s.description}${s.triggers.length ? ` [triggers: ${s.triggers.join(", ")}]` : ""}`
    )
    .join("\n");

  const prompt = `You are simulating an AI coding assistant's skill selection. Given a user query and a list of available skills, decide which skill (if any) should be activated.

Available skills:
${skillsList}

User query: "${query}"

Which skill should be activated? Respond with ONLY the skill name, or "none" if no skill matches. Do not explain.`;

  const response = await callLLM(prompt, llmOpts);
  const selected = response.trim().toLowerCase();
  return selected === targetSkill.name.toLowerCase();
}

async function evaluateSkill(
  skill: SkillMeta,
  allSkills: SkillMeta[],
  evalSet: EvalQuery[],
  llmOpts: { apiKey: string; model: string; baseUrl: string },
  verbose: boolean
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const eq of evalSet) {
    const skillWithCurrent = allSkills.map((s) =>
      s.name === skill.name ? skill : s
    );
    const triggered = await simulateTriggering(
      eq.query,
      skill,
      skillWithCurrent,
      llmOpts
    );
    const pass = eq.should_trigger === triggered;

    results.push({
      query: eq.query,
      should_trigger: eq.should_trigger,
      triggered,
      pass,
    });

    if (verbose) {
      const status = pass ? chalk.green("PASS") : chalk.red("FAIL");
      const expected = eq.should_trigger ? "trigger" : "skip";
      const actual = triggered ? "triggered" : "skipped";
      console.log(`    ${status} [expected: ${expected}, got: ${actual}] ${eq.query.slice(0, 70)}`);
    }
  }

  return results;
}

async function improveDescription(
  skill: SkillMeta,
  results: EvalResult[],
  history: IterationResult[],
  llmOpts: { apiKey: string; model: string; baseUrl: string }
): Promise<{ description: string; triggers: string[] }> {
  const failedTriggers = results.filter(
    (r) => r.should_trigger && !r.pass
  );
  const falseTriggers = results.filter(
    (r) => !r.should_trigger && !r.pass
  );

  const passed = results.filter((r) => r.pass).length;

  let historySection = "";
  if (history.length > 0) {
    historySection =
      "Previous attempts (do NOT repeat — try something structurally different):\n";
    for (const h of history) {
      historySection += `  Iteration ${h.iteration}: ${h.passed}/${h.total} passed\n`;
      historySection += `    Description: "${h.description}"\n`;
      historySection += `    Triggers: [${h.triggers.join(", ")}]\n`;
    }
  }

  const prompt = `You are optimizing a skill's description and trigger keywords for an AI coding assistant.

The skill appears in the assistant's available skills list. When a user sends a query, the assistant decides whether to activate the skill based on the name, description, and trigger keywords.

Skill name: ${skill.name}
Current description: "${skill.description}"
Current triggers: [${skill.triggers.join(", ")}]

Current score: ${passed}/${results.length}

${failedTriggers.length > 0 ? `FAILED TO TRIGGER (should have triggered but didn't):\n${failedTriggers.map((r) => `  - "${r.query}"`).join("\n")}\n` : ""}
${falseTriggers.length > 0 ? `FALSE TRIGGERS (triggered but shouldn't have):\n${falseTriggers.map((r) => `  - "${r.query}"`).join("\n")}\n` : ""}
${historySection}

Skill body (for context):
${skill.body.slice(0, 2000)}

Write an improved description and trigger list. Guidelines:
- Description should be 50-150 words, focused on user intent
- Use imperative form: "Use when..." not "This skill does..."
- Be distinctive — the description competes with other skills
- Triggers should be specific keywords/phrases that indicate this skill is needed
- Include both obvious and non-obvious trigger words
- Don't overfit to specific test queries — generalize

Respond with ONLY this JSON (no markdown fences):
{"description": "...", "triggers": ["word1", "word2", ...]}`;

  const response = await callLLM(prompt, llmOpts);
  const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    return JSON.parse(cleaned) as { description: string; triggers: string[] };
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as {
        description: string;
        triggers: string[];
      };
    }
    throw new Error("Failed to parse improvement from LLM response");
  }
}

async function listAllSkills(
  hubDir: string
): Promise<SkillMeta[]> {
  const skillsDir = join(hubDir, "skills");
  const skills: SkillMeta[] = [];

  if (!existsSync(skillsDir)) return skills;

  const { readdir } = await import("node:fs/promises");
  const folders = await readdir(skillsDir);

  for (const folder of folders) {
    const skillFile = join(skillsDir, folder, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const content = await readFile(skillFile, "utf-8");
    skills.push(parseSkillMd(content));
  }

  return skills;
}

function resolveLLMOpts(opts: {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}): { apiKey: string; model: string; baseUrl: string } {
  const apiKey =
    opts.apiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    "";
  const model = opts.model || process.env.HUB_OPTIMIZE_MODEL || "gpt-4o";
  const baseUrl =
    opts.baseUrl ||
    process.env.HUB_OPTIMIZE_BASE_URL ||
    "https://api.openai.com/v1";

  if (!apiKey) {
    console.log(
      chalk.red(
        "\n  No API key found. Set --api-key, OPENAI_API_KEY, or ANTHROPIC_API_KEY.\n"
      )
    );
    process.exit(1);
  }

  return { apiKey, model, baseUrl };
}

export const optimizeCommand = new Command("optimize")
  .description(
    "Optimize a skill's description and triggers for better activation accuracy"
  )
  .argument("<skill>", "Skill name to optimize")
  .option(
    "-i, --iterations <n>",
    "Max improvement iterations",
    "3"
  )
  .option("--api-key <key>", "OpenAI-compatible API key")
  .option("--model <model>", "Model to use (default: gpt-4o)")
  .option("--base-url <url>", "API base URL")
  .option("--eval-set <path>", "Path to custom eval set JSON")
  .option("--dry-run", "Show proposed changes without applying")
  .option("-v, --verbose", "Show detailed progress")
  .option("--save-report <path>", "Save optimization report to JSON file")
  .action(
    async (
      skillName: string,
      opts: {
        iterations: string;
        apiKey?: string;
        model?: string;
        baseUrl?: string;
        evalSet?: string;
        dryRun?: boolean;
        verbose?: boolean;
        saveReport?: string;
      }
    ) => {
      const hubDir = process.cwd();
      const skillFile = join(hubDir, "skills", skillName, "SKILL.md");

      if (!existsSync(skillFile)) {
        console.log(
          chalk.red(`\n  Skill '${skillName}' not found at skills/${skillName}/SKILL.md\n`)
        );
        return;
      }

      const llmOpts = resolveLLMOpts(opts);
      const maxIterations = parseInt(opts.iterations, 10);
      const verbose = opts.verbose ?? false;

      console.log(chalk.blue(`\n  Optimizing skill: ${skillName}`));
      console.log(chalk.dim(`  Model: ${llmOpts.model}`));
      console.log(chalk.dim(`  Max iterations: ${maxIterations}\n`));

      const originalContent = await readFile(skillFile, "utf-8");
      const originalSkill = parseSkillMd(originalContent);
      const allSkills = await listAllSkills(hubDir);

      console.log(
        chalk.dim(`  Current description: "${originalSkill.description}"`)
      );
      console.log(
        chalk.dim(`  Current triggers: [${originalSkill.triggers.join(", ")}]\n`)
      );

      let evalSet: EvalQuery[];
      if (opts.evalSet) {
        const evalContent = await readFile(opts.evalSet, "utf-8");
        evalSet = JSON.parse(evalContent) as EvalQuery[];
        console.log(
          chalk.cyan(`  Loaded ${evalSet.length} eval queries from ${opts.evalSet}\n`)
        );
      } else {
        console.log(chalk.cyan("  Generating eval queries...\n"));
        evalSet = await generateEvalQueries(originalSkill, allSkills, llmOpts);

        if (verbose) {
          const shouldTrigger = evalSet.filter((e) => e.should_trigger);
          const shouldNot = evalSet.filter((e) => !e.should_trigger);
          console.log(chalk.dim(`  Should trigger (${shouldTrigger.length}):`));
          for (const q of shouldTrigger) {
            console.log(chalk.dim(`    + ${q.query.slice(0, 80)}`));
          }
          console.log(chalk.dim(`  Should NOT trigger (${shouldNot.length}):`));
          for (const q of shouldNot) {
            console.log(chalk.dim(`    - ${q.query.slice(0, 80)}`));
          }
          console.log();
        }
      }

      let currentSkill = { ...originalSkill };
      const history: IterationResult[] = [];
      let bestIteration: IterationResult | null = null;

      for (let i = 1; i <= maxIterations; i++) {
        console.log(chalk.blue(`  ── Iteration ${i}/${maxIterations} ──\n`));

        if (verbose) {
          console.log(chalk.dim(`  Description: "${currentSkill.description}"`));
          console.log(
            chalk.dim(`  Triggers: [${currentSkill.triggers.join(", ")}]\n`)
          );
        }

        console.log(chalk.cyan("  Evaluating...\n"));
        const results = await evaluateSkill(
          currentSkill,
          allSkills,
          evalSet,
          llmOpts,
          verbose
        );

        const passed = results.filter((r) => r.pass).length;
        const failed = results.length - passed;

        const iteration: IterationResult = {
          iteration: i,
          description: currentSkill.description,
          triggers: [...currentSkill.triggers],
          results,
          passed,
          failed,
          total: results.length,
        };
        history.push(iteration);

        console.log(
          `\n  Score: ${chalk.green(`${passed}`)}/${results.length} passed, ${chalk.red(`${failed}`)} failed\n`
        );

        if (!bestIteration || passed > bestIteration.passed) {
          bestIteration = iteration;
        }

        if (failed === 0) {
          console.log(chalk.green("  All queries passed!\n"));
          break;
        }

        if (i === maxIterations) {
          console.log(chalk.yellow("  Max iterations reached.\n"));
          break;
        }

        console.log(chalk.cyan("  Improving description...\n"));
        const improved = await improveDescription(
          currentSkill,
          results,
          history,
          llmOpts
        );

        currentSkill = {
          ...currentSkill,
          description: improved.description,
          triggers: improved.triggers,
        };
      }

      if (!bestIteration) {
        console.log(chalk.red("  No iterations completed.\n"));
        return;
      }

      console.log(chalk.blue("  ── Results ──\n"));
      console.log(
        chalk.dim(`  Original:  "${originalSkill.description}"`)
      );
      console.log(
        chalk.dim(`             [${originalSkill.triggers.join(", ")}]`)
      );
      console.log(
        chalk.green(`  Best:      "${bestIteration.description}"`)
      );
      console.log(
        chalk.green(`             [${bestIteration.triggers.join(", ")}]`)
      );
      console.log(
        chalk.green(
          `  Score:     ${bestIteration.passed}/${bestIteration.total}\n`
        )
      );

      if (opts.saveReport) {
        const report = {
          skill: skillName,
          original: {
            description: originalSkill.description,
            triggers: originalSkill.triggers,
          },
          best: {
            description: bestIteration.description,
            triggers: bestIteration.triggers,
            score: `${bestIteration.passed}/${bestIteration.total}`,
          },
          eval_set: evalSet,
          history,
        };
        await mkdir(join(opts.saveReport, ".."), { recursive: true }).catch(
          () => {}
        );
        await writeFile(opts.saveReport, JSON.stringify(report, null, 2));
        console.log(chalk.dim(`  Report saved to ${opts.saveReport}\n`));
      }

      if (opts.dryRun) {
        console.log(chalk.yellow("  Dry run — no changes applied.\n"));
        return;
      }

      if (
        bestIteration.description === originalSkill.description &&
        JSON.stringify(bestIteration.triggers) ===
          JSON.stringify(originalSkill.triggers)
      ) {
        console.log(
          chalk.dim("  No improvement found — skill unchanged.\n")
        );
        return;
      }

      const updatedContent = rebuildSkillMd(
        originalContent,
        bestIteration.description,
        bestIteration.triggers
      );
      await writeFile(skillFile, updatedContent);
      console.log(
        chalk.green(`  Updated skills/${skillName}/SKILL.md\n`)
      );
    }
  );

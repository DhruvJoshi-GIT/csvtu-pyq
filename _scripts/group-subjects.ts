// Group related subject folders under a parent topic.
// Example outcome:
//   Sem-3/applied-mathematics/...
//   Sem-3/engineering-mathematics-1/...
//   Sem-3/mathematics-3/...
// becomes:
//   Sem-3/Mathematics/applied-mathematics/...
//   Sem-3/Mathematics/engineering-mathematics-1/...
//   Sem-3/Mathematics/mathematics-3/...
//
// The original variant folders are preserved under the new topic parent —
// nothing is collapsed, only grouped one level up so a viewer sees fewer
// top-level entries.

import { readdir, stat, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "D:/CLaude/PYQ";

// Each rule: a topic name and a list of regex patterns matched against
// the lowercased subject-folder name. First match wins. A folder that
// matches no rule is left at top level.
type Rule = { topic: string; patterns: RegExp[] };

const rules: Rule[] = [
  {
    topic: "Mathematics",
    patterns: [
      /^applied-math/, /^engineering-math/, /^engineeing-math/,
      /^mathematic/, /^maths\b/, /^applied-maths/, /^remedial-math/,
      /^discrete-math/, /^numerical-method/, /^numerical-analysis/,
      /^applied-numerical/, /-mathematics(?:-\d)?$/,
      /^calculus/, /^probability/, /^statistic/, /^linear-algebra/,
      /^differential-equation/, /^complex-variable/, /^vector-calculus/,
      /^operations-research/, /^operation-research/,
      /^transform-and-partial/, /^transforms-and-/,
    ],
  },
  {
    topic: "Physics",
    patterns: [
      /^applied-physic/, /^engineering-physic/, /^physic/,
      /^modern-physic/, /^solid-state-physic/, /^semiconductor-physic/,
    ],
  },
  {
    topic: "Chemistry",
    patterns: [
      /^applied-chemistr/, /^engineering-chemistr/, /^chemistr/,
      /^remedial-chemistr/, /^pharmaceutical-chemistr/,
      /^pharmaceutical-organic-chem/, /^pharmaceutical-inorganic-chem/,
      /^pharmaceutical-organic-chemsitry/,
      /^medicinal-chemistr/, /^organic-chemistr/, /^inorganic-chemistr/,
    ],
  },
  {
    topic: "Communication-and-English",
    patterns: [
      /^english\b/, /^business-english/, /^professional-communication/,
      /^communication-skill/, /^technical-communication/,
      /^technical-english/, /^language-and-/, /^functional-english/,
    ],
  },
  {
    topic: "Engineering-Graphics-and-Mechanics",
    patterns: [
      /^engineering-graphics/, /^engineeing-graphics/,
      /^engineering-drawing/, /^engineering-mechanic/,
      /^applied-mechanic/, /^mechanics-of-solid/, /^mechanics$/,
      /^strength-of-material/,
    ],
  },
  {
    topic: "Electrical-Basics",
    patterns: [
      /^basic-electrical/, /^elements-of-electrical/,
      /^fundamentals-of-electrical/, /^elementary-electrical/,
      /^electrical-and-electronic/, /^basic-electronics/,
      /^elements-of-electronic/, /^fundamentals-of-electronic/,
    ],
  },
  {
    topic: "Civil-Basics",
    patterns: [
      /^basic-civil/, /^elements-of-civil/, /^fundamentals-of-civil/,
    ],
  },
  {
    topic: "Mechanical-Basics",
    patterns: [
      /^basic-mechanical/, /^elements-of-mechanical/,
      /^fundamentals-of-mechanical/,
    ],
  },
  {
    topic: "Computer-Fundamentals-and-Programming",
    patterns: [
      /^fundamentals-of-computer/, /^computer-fundamental/,
      /^computer-concept/, /^computer-application/,
      /^problem-solving-and-logic/, /^problem-solving-and-login/,
      /^problem-solving-technique/,
      /^introduction-to-computer/, /^c-programming/, /^programming-in-c/,
      /^programming-with-c/,
    ],
  },
  {
    topic: "Environmental-Studies",
    patterns: [
      /^environmental/, /^enviromental/, /^environment-and-/,
      /^energy-and-environment/, /^ecology-and-environment/,
    ],
  },
  {
    topic: "Indian-Knowledge-and-Constitution",
    patterns: [
      /^foundation-course-on-ancient/, /^indian-knowledge/,
      /^indian-constitution/, /^constitution-of-india/,
      /^essence-of-indian/, /^value-and-ethic/, /^human-value/,
      /^professional-ethic/, /^universal-human-value/,
    ],
  },
  {
    topic: "Workshop-Practice",
    patterns: [
      /^workshop-practic/, /^manufacturing-practic/, /^workshop-technolog/,
    ],
  },
  // -------- Higher-sem groupings --------
  {
    topic: "Database-Systems",
    patterns: [
      /^database/, /^dbms\b/, /^data-base/, /^advanced-database/,
      /^distributed-database/, /^data-warehouse/, /^big-data/,
    ],
  },
  {
    topic: "Operating-Systems",
    patterns: [
      /^operating-system/, /^operating-systems/, /^advanced-operating-system/,
      /^distributed-system/, /^distributed-operating/,
    ],
  },
  {
    topic: "Computer-Networks",
    patterns: [
      /^computer-network/, /^data-communication/,
      /^advanced-computer-network/, /^wireless-network/, /^mobile-network/,
      /^wireless-and-mobile/, /^ad-hoc-network/, /^sensor-network/,
    ],
  },
  {
    topic: "Data-Structures-and-Algorithms",
    patterns: [
      /^data-structure/, /^algorithm/, /^design-and-analysis-of-algorithm/,
      /^advanced-data-structure/, /^advanced-algorithm/,
    ],
  },
  {
    topic: "AI-and-ML",
    patterns: [
      /^artificial-intelligence/, /^machine-learning/, /^deep-learning/,
      /^neural-network/, /^pattern-recognition/, /^expert-system/,
      /^soft-computing/, /^natural-language/, /^reinforcement-learning/,
    ],
  },
  {
    topic: "Software-Engineering",
    patterns: [
      /^software-engineering/, /^software-project/, /^software-quality/,
      /^software-testing/, /^software-architecture/, /^software-design/,
      /^object-oriented-software/, /^agile-/, /^software-process/,
    ],
  },
  {
    topic: "Web-and-Internet",
    patterns: [
      /^web-technolog/, /^internet-and-web/, /^internet-technolog/,
      /^web-engineering/, /^web-programming/, /^web-design/,
      /^xml/, /^html/, /^semantic-web/,
    ],
  },
  {
    topic: "Compiler-and-Theory",
    patterns: [
      /^compiler/, /^theory-of-computation/, /^automata/,
      /^formal-language/, /^principles-of-programming/, /^programming-language/,
    ],
  },
  {
    topic: "Cyber-Security-and-Cryptography",
    patterns: [
      /^cyber-security/, /^cyber-crime/, /^information-security/,
      /^network-security/, /^cryptography/, /^cryptography-and-network/,
      /^security-/, /^ethical-hacking/, /^digital-forensic/,
    ],
  },
  {
    topic: "Object-Oriented-Programming",
    patterns: [
      /^object-oriented-programming/, /^object-oriented-concept/,
      /^java-programming/, /^advanced-java/, /^cpp\b/, /^c-plus-plus/,
      /^python-programming/,
    ],
  },
  {
    topic: "Microprocessors-and-Embedded",
    patterns: [
      /^microprocessor/, /^microcontroller/, /^embedded-system/,
      /^vlsi/, /^system-on-chip/, /^digital-system-design/,
    ],
  },
  {
    topic: "Digital-and-Logic-Design",
    patterns: [
      /^digital-electronics/, /^digital-logic/, /^logic-design/,
      /^switching-theory/,
    ],
  },
  {
    topic: "Analog-Electronics",
    patterns: [
      /^analog-electronic/, /^analog-circuit/, /^electronic-device/,
      /^electronic-circuit/, /^electronics-device/,
    ],
  },
  {
    topic: "Signals-and-Systems",
    patterns: [
      /^signal-and-system/, /^signals-and-system/, /^digital-signal-processing/,
      /^communication-system/, /^digital-communication/,
      /^analog-communication/, /^satellite-communication/,
      /^optical-communication/, /^mobile-communication/,
    ],
  },
  {
    topic: "Control-Systems",
    patterns: [
      /^control-system/, /^modern-control/, /^process-control/,
      /^digital-control/, /^automatic-control/,
    ],
  },
  {
    topic: "Power-Systems",
    patterns: [
      /^power-system/, /^power-electronic/, /^power-generation/,
      /^transmission-and-distribution/, /^utilization-of-electrical/,
      /^switchgear/, /^high-voltage/, /^renewable-energy/, /^energy-conservation/,
    ],
  },
  {
    topic: "Electrical-Machines",
    patterns: [
      /^electrical-machine/, /^electric-machine/, /^dc-machine/, /^ac-machine/,
      /^transformer/, /^induction-motor/, /^synchronous-machine/,
    ],
  },
  {
    topic: "Thermodynamics-and-Heat-Transfer",
    patterns: [
      /^thermodynamic/, /^engineering-thermodynamic/, /^applied-thermodynamic/,
      /^heat-transfer/, /^heat-and-mass/, /^heat-engine/,
      /^refrigeration/, /^air-conditioning/, /^ic-engine/,
      /^internal-combustion/,
    ],
  },
  {
    topic: "Fluid-Mechanics-and-Machinery",
    patterns: [
      /^fluid-mechanic/, /^fluid-machine/, /^fluid-power/,
      /^hydraulic/, /^pneumatic/, /^turbomachine/, /^turbo-machine/,
    ],
  },
  {
    topic: "Manufacturing-and-Production",
    patterns: [
      /^manufacturing/, /^production/, /^machining/, /^machine-tool/,
      /^metal-cutting/, /^metal-forming/, /^casting-and-/,
      /^welding/, /^foundry/,
    ],
  },
  {
    topic: "Machine-Design-and-Theory",
    patterns: [
      /^machine-design/, /^design-of-machine/, /^theory-of-machine/,
      /^dynamics-of-machine/, /^kinematic/, /^mechanism/,
      /^vibration/, /^mechanical-vibration/,
    ],
  },
  {
    topic: "Surveying-and-Transportation",
    patterns: [
      /^surveying/, /^transportation-engineering/, /^highway-engineering/,
      /^railway-engineering/, /^bridge-engineering/, /^traffic-engineering/,
    ],
  },
  {
    topic: "Structural-and-Concrete",
    patterns: [
      /^structural-analysis/, /^structural-design/, /^design-of-structure/,
      /^concrete-technolog/, /^reinforced-concrete/, /^prestressed-concrete/,
      /^steel-structure/, /^design-of-steel/, /^design-of-rcc/,
      /^design-of-reinforced/, /^advanced-structural/,
    ],
  },
  {
    topic: "Soil-and-Foundation",
    patterns: [
      /^soil-mechanic/, /^geotechnical/, /^foundation-engineering/,
      /^rock-mechanic/, /^earth-and-rockfill/,
    ],
  },
  {
    topic: "Water-Resources-and-Hydraulics",
    patterns: [
      /^water-resource/, /^irrigation/, /^hydrology/, /^hydraulic-engineering/,
      /^public-health-engineer/, /^water-supply/, /^waste-water/,
      /^environmental-engineering/, /^sanitary-engineering/,
    ],
  },
  {
    topic: "Management-and-Economics",
    patterns: [
      /^management\b/, /^industrial-management/, /^total-quality/,
      /^operation-management/, /^operations-management/, /^project-management/,
      /^human-resource/, /^marketing/, /^financial-management/,
      /^strategic-management/, /^business-/, /^entrepreneurship/,
      /^industrial-engineering/, /^economic/, /^engineering-economic/,
      /^accounting/, /^organizational-behaviour/, /^organisational-behaviour/,
    ],
  },
];

function pickTopic(name: string): string | null {
  const lower = name.toLowerCase();
  for (const r of rules) {
    for (const p of r.patterns) {
      if (p.test(lower)) return r.topic;
    }
  }
  return null;
}

async function isDir(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function processSem(semDir: string, dryRun = false): Promise<{ moves: number; topics: Set<string> }> {
  const entries = await readdir(semDir, { withFileTypes: true });
  let moves = 0;
  const topics = new Set<string>();
  // Build map: topic -> list of folder names to move
  const byTopic = new Map<string, string[]>();
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // Skip already-grouped topic folders (heuristic: PascalCase / Title-Case-with-dashes
    // and matches one of our topic names so we don't re-group)
    if (rules.some(r => r.topic === e.name)) continue;
    const topic = pickTopic(e.name);
    if (!topic) continue;
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic)!.push(e.name);
  }
  for (const [topic, names] of byTopic) {
    if (names.length === 0) continue;
    topics.add(topic);
    const topicDir = join(semDir, topic);
    if (!dryRun) await mkdir(topicDir, { recursive: true });
    for (const name of names) {
      const src = join(semDir, name);
      const dst = join(topicDir, name);
      if (!dryRun) {
        try {
          await rename(src, dst);
          moves++;
        } catch (e: any) {
          // Destination might already exist (re-run); skip
          if (e.code !== "ENOTEMPTY" && e.code !== "EEXIST") {
            console.error(`  Move failed ${src} -> ${dst}: ${e.message}`);
          }
        }
      } else {
        moves++;
      }
    }
  }
  return { moves, topics };
}

async function walk(courseDir: string, dryRun: boolean): Promise<void> {
  for (const top of await readdir(courseDir, { withFileTypes: true })) {
    if (!top.isDirectory()) continue;
    const topPath = join(courseDir, top.name);
    if (top.name.startsWith("Sem-") || top.name === "Unknown-Sem" || top.name === "1st-Year") {
      const r = await processSem(topPath, dryRun);
      if (r.moves) {
        console.log(`  ${topPath}: grouped ${r.moves} folder(s) into ${r.topics.size} topic(s) [${[...r.topics].join(", ")}]`);
      }
    } else {
      // Branch folder — recurse
      for (const sem of await readdir(topPath, { withFileTypes: true })) {
        if (!sem.isDirectory()) continue;
        const semPath = join(topPath, sem.name);
        const r = await processSem(semPath, dryRun);
        if (r.moves) {
          console.log(`  ${semPath}: grouped ${r.moves} folder(s) into ${r.topics.size} topic(s) [${[...r.topics].join(", ")}]`);
        }
      }
    }
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("DRY RUN — no changes will be made");
  for (const course of await readdir(ROOT, { withFileTypes: true })) {
    if (!course.isDirectory() || course.name.startsWith("_")) continue;
    console.log(`Processing ${course.name}...`);
    await walk(join(ROOT, course.name), dryRun);
  }
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });

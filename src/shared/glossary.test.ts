import test from "node:test";
import assert from "node:assert/strict";
import {
  parseGlossary,
  serializeGlossary,
  buildGlossaryPromptSection,
  injectGlossaryIntoPrompt,
} from "./glossary.ts";

test("glossary - parseGlossary handles various formats and comments", () => {
  const raw = `
# Comment line
// Another comment
Gemini = 双子星
DeepSeek: 深度求索
TypeScript -> 强类型JS
  Claude = 克劳德  
Invalid line without separator
= target only
source only =
`;

  const entries = parseGlossary(raw);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[0], { source: "Gemini", target: "双子星" });
  assert.deepEqual(entries[1], { source: "DeepSeek", target: "深度求索" });
  assert.deepEqual(entries[2], { source: "TypeScript", target: "强类型JS" });
  assert.deepEqual(entries[3], { source: "Claude", target: "克劳德" });
});

test("glossary - serializeGlossary formats entries properly", () => {
  const entries = [
    { source: "Gemini", target: "双子星" },
    { source: "Claude", target: "克劳德" },
  ];
  const serialized = serializeGlossary(entries);
  assert.equal(serialized, "Gemini=双子星\nClaude=克劳德");
});

test("glossary - buildGlossaryPromptSection and injectGlossaryIntoPrompt", () => {
  const raw = "Gemini=双子星\nClaude=克劳德";
  const section = buildGlossaryPromptSection(raw);
  assert.ok(section.includes("Terminology & Glossary"));
  assert.ok(section.includes('- "Gemini" => "双子星"'));
  assert.ok(section.includes('- "Claude" => "克劳德"'));

  const basePrompt = "You are a translator.";
  const injected = injectGlossaryIntoPrompt(basePrompt, raw);
  assert.ok(injected.startsWith("You are a translator."));
  assert.ok(injected.includes('- "Gemini" => "双子星"'));

  // Empty glossary shouldn't change prompt
  assert.equal(injectGlossaryIntoPrompt(basePrompt, ""), basePrompt);
});

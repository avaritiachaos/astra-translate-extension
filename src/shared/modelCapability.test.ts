import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isVisionCapable,
  getModelCapabilityKind,
} from "./modelCapability.ts";

describe("modelCapability - isVisionCapable", () => {
  it("detects Google Gemini as vision-capable", () => {
    assert.equal(isVisionCapable("google-gemini", "gemini-3.7-flash"), true);
    assert.equal(isVisionCapable("google-gemini", "gemini-2.0-flash"), true);
    assert.equal(isVisionCapable("google-gemini", ""), true);
  });

  it("detects DeepSeek as text-only", () => {
    assert.equal(isVisionCapable("deepseek", "deepseek-chat"), false);
    assert.equal(isVisionCapable("deepseek", "deepseek-v3"), false);
    assert.equal(isVisionCapable("deepseek", "deepseek-v4-flash"), false);
    assert.equal(isVisionCapable("deepseek", "deepseek-reasoner"), false);
  });

  it("detects OpenAI multimodal models", () => {
    assert.equal(isVisionCapable("custom-openai-compatible", "gpt-4o"), true);
    assert.equal(isVisionCapable("custom-openai-compatible", "gpt-4o-mini"), true);
    assert.equal(isVisionCapable("custom-openai-compatible", "gpt-4-turbo"), true);
    assert.equal(isVisionCapable("custom-openai-compatible", "gpt-4-vision-preview"), true);
  });

  it("detects Claude multimodal models", () => {
    assert.equal(isVisionCapable("custom-openai-compatible", "claude-3-5-sonnet-20241022"), true);
    assert.equal(isVisionCapable("custom-openai-compatible", "claude-3-opus"), true);
  });

  it("detects open-source vision models", () => {
    assert.equal(isVisionCapable("custom-openai-compatible", "Qwen/Qwen2-VL-72B-Instruct"), true);
    assert.equal(isVisionCapable("custom-openai-compatible", "internvl-chat-v1-5"), true);
    assert.equal(isVisionCapable("custom-openai-compatible", "pixtral-12b"), true);
    assert.equal(isVisionCapable("custom-openai-compatible", "llava-v1.6-34b"), true);
  });

  it("detects standard text models as text-only", () => {
    assert.equal(isVisionCapable("custom-openai-compatible", "meta-llama/Llama-3-70b-instruct"), false);
    assert.equal(isVisionCapable("custom-openai-compatible", "qwen-2.5-72b-instruct"), false);
    assert.equal(isVisionCapable("custom-openai-compatible", "mistral-small"), false);
  });

  it("handles empty/unknown parameters gracefully", () => {
    assert.equal(isVisionCapable(undefined, undefined), false);
    assert.equal(isVisionCapable("", ""), false);
  });
});

describe("modelCapability - getModelCapabilityKind", () => {
  it("returns vision or text", () => {
    assert.equal(getModelCapabilityKind("google-gemini", "gemini-3.7-flash"), "vision");
    assert.equal(getModelCapabilityKind("deepseek", "deepseek-chat"), "text");
  });
});

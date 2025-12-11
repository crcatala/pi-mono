import { describe, expect, test } from "vitest";
import { parseArgs } from "../src/cli/args.js";

describe("parseArgs", () => {
	test("--version flag sets version to true", () => {
		const result = parseArgs(["--version"]);
		expect(result.version).toBe(true);
	});

	test("-v flag sets version to true", () => {
		const result = parseArgs(["-v"]);
		expect(result.version).toBe(true);
	});

	test("--help flag sets help to true", () => {
		const result = parseArgs(["--help"]);
		expect(result.help).toBe(true);
	});

	test("-h flag sets help to true", () => {
		const result = parseArgs(["-h"]);
		expect(result.help).toBe(true);
	});

	test("messages are collected from non-flag arguments", () => {
		const result = parseArgs(["hello", "world"]);
		expect(result.messages).toEqual(["hello", "world"]);
	});

	test("file args starting with @ are collected separately", () => {
		const result = parseArgs(["@file.txt", "@image.png"]);
		expect(result.fileArgs).toEqual(["file.txt", "image.png"]);
	});

	test("--print flag sets print to true", () => {
		const result = parseArgs(["--print"]);
		expect(result.print).toBe(true);
	});

	test("-p flag sets print to true", () => {
		const result = parseArgs(["-p"]);
		expect(result.print).toBe(true);
	});

	test("--continue flag sets continue to true", () => {
		const result = parseArgs(["--continue"]);
		expect(result.continue).toBe(true);
	});

	test("-c flag sets continue to true", () => {
		const result = parseArgs(["-c"]);
		expect(result.continue).toBe(true);
	});

	test("multiple flags can be combined", () => {
		const result = parseArgs(["--print", "--continue", "my message"]);
		expect(result.print).toBe(true);
		expect(result.continue).toBe(true);
		expect(result.messages).toEqual(["my message"]);
	});
});

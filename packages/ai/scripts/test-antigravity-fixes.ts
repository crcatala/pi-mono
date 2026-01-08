#!/usr/bin/env npx tsx
/**
 * Test the proposed Antigravity fixes:
 * 1. userAgent: "antigravity" in body (instead of "pi-coding-agent")
 * 2. sessionId in the request
 * 3. Endpoint fallbacks (daily -> autopush -> prod)
 *
 * Usage:
 *   npx tsx test-antigravity-fixes.ts
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { refreshAntigravityToken } from "../src/utils/oauth/google-antigravity.js";

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const NC = "\x1b[0m";

// Endpoints to try (in fallback order per opencode-antigravity)
const ENDPOINTS = {
	daily: "https://daily-cloudcode-pa.sandbox.googleapis.com",
	autopush: "https://autopush-cloudcode-pa.sandbox.googleapis.com",
	prod: "https://cloudcode-pa.googleapis.com",
};

// Headers matching opencode-antigravity
const HEADERS = {
	"User-Agent": "antigravity/1.11.5 darwin/arm64",
	"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
	"Client-Metadata": JSON.stringify({
		ideType: "IDE_UNSPECIFIED",
		platform: "PLATFORM_UNSPECIFIED",
		pluginType: "GEMINI",
	}),
};

interface AntigravityCreds {
	access?: string;
	refresh?: string;
	expires?: number;
	projectId?: string;
}

interface AuthJson {
	"google-antigravity"?: AntigravityCreds;
}

function generateSessionId(): string {
	return `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function generateRequestId(): string {
	return `req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function getCredentials(): Promise<{ accessToken: string; projectId: string }> {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const authPaths = [
		"auth.json",
		"../auth.json",
		"../../auth.json",
		`${home}/.pi/agent/auth.json`,
	];

	let authPath: string | undefined;
	let auth: AuthJson | undefined;

	for (const path of authPaths) {
		if (existsSync(path)) {
			console.log(`Reading credentials from ${path}...`);
			auth = JSON.parse(readFileSync(path, "utf-8"));
			authPath = path;
			break;
		}
	}

	if (!auth || !authPath) {
		throw new Error("Could not find auth.json");
	}

	const creds = auth["google-antigravity"];
	if (!creds?.refresh || !creds?.projectId) {
		throw new Error("Missing refresh token or projectId in google-antigravity credentials");
	}

	const needsRefresh = !creds.access || !creds.expires || Date.now() >= creds.expires;

	if (needsRefresh) {
		console.log("Token expired or missing, refreshing...");
		const newCreds = await refreshAntigravityToken(creds.refresh, creds.projectId);
		console.log(`Token refreshed, new expiry: ${new Date(newCreds.expires).toISOString()}`);

		auth["google-antigravity"] = { ...creds, ...newCreds };
		writeFileSync(authPath, JSON.stringify(auth, null, 2));
		console.log(`Updated ${authPath} with refreshed token`);

		return { accessToken: newCreds.access, projectId: newCreds.projectId! };
	}

	return { accessToken: creds.access, projectId: creds.projectId };
}

interface TestResult {
	endpoint: string;
	status: number;
	success: boolean;
	response?: string;
	error?: string;
}

async function testEndpoint(
	endpointName: string,
	endpointUrl: string,
	accessToken: string,
	projectId: string,
	model: string,
	useNewFormat: boolean,
): Promise<TestResult> {
	const url = `${endpointUrl}/v1internal:streamGenerateContent?alt=sse`;
	const sessionId = generateSessionId();
	const requestId = generateRequestId();

	// Build request body
	let body: Record<string, unknown>;

	if (useNewFormat) {
		// New format matching opencode-antigravity
		body = {
			project: projectId,
			model: model,
			request: {
				contents: [{ role: "user", parts: [{ text: "Say hi" }] }],
				sessionId: sessionId, // Added sessionId inside request
			},
			userAgent: "antigravity", // Changed from "pi-coding-agent"
			requestId: requestId,
		};
	} else {
		// Old format (our current implementation)
		body = {
			project: projectId,
			model: model,
			request: {
				contents: [{ role: "user", parts: [{ text: "Say hi" }] }],
			},
			userAgent: "pi-coding-agent",
			requestId: requestId,
		};
	}

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15000);

		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				...HEADERS,
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		clearTimeout(timeout);

		const text = await response.text();

		return {
			endpoint: endpointName,
			status: response.status,
			success: response.status === 200,
			response: text.slice(0, 300),
		};
	} catch (error) {
		return {
			endpoint: endpointName,
			status: 0,
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function printResult(result: TestResult, label: string) {
	const statusStr =
		result.status === 200
			? `${GREEN}[200 OK]${NC}`
			: result.status === 429
				? `${RED}[429 RATE LIMITED]${NC}`
				: result.status === 403
					? `${YELLOW}[403 FORBIDDEN]${NC}`
					: result.status === 0
						? `${YELLOW}[TIMEOUT/ERROR]${NC}`
						: `${YELLOW}[HTTP ${result.status}]${NC}`;

	console.log(`${statusStr} ${label}`);

	if (result.status === 200) {
		// Show first part of successful response
		const preview = result.response?.slice(0, 100) || "";
		console.log(`    ${CYAN}Response: ${preview}...${NC}`);
	} else if (result.error) {
		console.log(`    Error: ${result.error}`);
	} else if (result.response) {
		// Extract error message if present
		const match = result.response.match(/"message":\s*"([^"]+)"/);
		if (match) {
			console.log(`    Message: ${match[1].slice(0, 150)}`);
		}
	}
}

async function main() {
	console.log("=".repeat(60));
	console.log("Testing Antigravity Fixes");
	console.log("=".repeat(60));
	console.log("");

	const { accessToken, projectId } = await getCredentials();
	console.log(`Project ID: ${projectId}`);
	console.log(`Token: ${accessToken.slice(0, 20)}...`);
	console.log("");

	const models = ["gemini-3-pro", "gemini-2.5-flash"];

	for (const model of models) {
		console.log("-".repeat(60));
		console.log(`Model: ${model}`);
		console.log("-".repeat(60));
		console.log("");

		// Test OLD format (current implementation)
		console.log(`${CYAN}OLD FORMAT (userAgent: "pi-coding-agent", no sessionId):${NC}`);
		for (const [name, url] of Object.entries(ENDPOINTS)) {
			const result = await testEndpoint(name, url, accessToken, projectId, model, false);
			printResult(result, `${name} endpoint`);
			await new Promise((r) => setTimeout(r, 1000));
		}
		console.log("");

		// Test NEW format (proposed fixes)
		console.log(`${CYAN}NEW FORMAT (userAgent: "antigravity", with sessionId):${NC}`);
		for (const [name, url] of Object.entries(ENDPOINTS)) {
			const result = await testEndpoint(name, url, accessToken, projectId, model, true);
			printResult(result, `${name} endpoint`);
			await new Promise((r) => setTimeout(r, 1000));
		}
		console.log("");
	}

	console.log("=".repeat(60));
	console.log("Test Complete");
	console.log("=".repeat(60));
	console.log("");
	console.log("If NEW FORMAT shows 200 OK on any endpoint, the fixes should work.");
	console.log("If all show 429, the rate limit may be account-wide (multi-account needed).");
}

main().catch((err) => {
	console.error(`${RED}Error:${NC}`, err.message);
	process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Test different userAgent values against the Antigravity sandbox endpoint
 * to find which ones work without getting 429 rate limit errors.
 *
 * Usage:
 *   npx tsx test-antigravity-useragent.ts
 *   npx tsx test-antigravity-useragent.ts <access_token> <project_id>
 *
 * Reads from auth.json in current directory if no args provided.
 * Automatically refreshes expired tokens using the refresh token.
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { refreshAntigravityToken } from "../src/utils/oauth/google-antigravity.js";

const ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse";
const MODEL = "gemini-3-pro";

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const NC = "\x1b[0m";

interface AntigravityCreds {
	access?: string;
	refresh?: string;
	expires?: number;
	projectId?: string;
}

interface AuthJson {
	"google-antigravity"?: AntigravityCreds;
}

interface TestResult {
	label: string;
	status: number;
	success: boolean;
	response?: string;
}

async function getCredentials(): Promise<{ accessToken: string; projectId: string }> {
	// Check command line args
	if (process.argv[2] && process.argv[3]) {
		return { accessToken: process.argv[2], projectId: process.argv[3] };
	}

	// Try auth.json in various locations
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const authPaths = [
		"auth.json",
		"../auth.json",
		"../../auth.json",
		`${home}/.pi/agent/auth.json`, // pi-coding-agent default location
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
		throw new Error(
			"Could not find credentials. Usage:\n" +
				"  npx tsx test-antigravity-useragent.ts <access_token> <project_id>\n" +
				"  or place auth.json with google-antigravity credentials in current directory",
		);
	}
	
	const creds = auth["google-antigravity"];
	if (!creds?.refresh || !creds?.projectId) {
		throw new Error("Missing refresh token or projectId in google-antigravity credentials");
	}
	
	// Check if token needs refresh (or always refresh to be safe)
	const needsRefresh = !creds.access || !creds.expires || Date.now() >= creds.expires;
	
	if (needsRefresh) {
		console.log("Token expired or missing, refreshing...");
		try {
			const newCreds = await refreshAntigravityToken(creds.refresh, creds.projectId);
			console.log(`Token refreshed, new expiry: ${new Date(newCreds.expires).toISOString()}`);
			
			// Update auth.json with new credentials
			auth["google-antigravity"] = { ...creds, ...newCreds };
			writeFileSync(authPath, JSON.stringify(auth, null, 2));
			console.log(`Updated ${authPath} with refreshed token`);
			
			return { accessToken: newCreds.access, projectId: newCreds.projectId! };
		} catch (err) {
			console.error("Failed to refresh token:", err);
			throw new Error("Token refresh failed. Try /login google-antigravity to re-authenticate.");
		}
	}
	
	return { accessToken: creds.access, projectId: creds.projectId };
}

async function testRequest(
	accessToken: string,
	projectId: string,
	bodyUserAgent: string | undefined,
	httpUserAgent: string,
	extraBody?: Record<string, unknown>,
): Promise<TestResult> {
	const label = bodyUserAgent === undefined ? "body.userAgent: (omitted)" : `body.userAgent: "${bodyUserAgent}"`;

	const body: Record<string, unknown> = {
		project: projectId,
		model: MODEL,
		request: {
			contents: [{ role: "user", parts: [{ text: "Say hi" }] }],
		},
		requestId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		...extraBody,
	};

	if (bodyUserAgent !== undefined) {
		body.userAgent = bodyUserAgent;
	}

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10000);

		const response = await fetch(ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				"User-Agent": httpUserAgent,
				"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
				"Client-Metadata": JSON.stringify({
					ideType: "IDE_UNSPECIFIED",
					platform: "PLATFORM_UNSPECIFIED",
					pluginType: "GEMINI",
				}),
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		clearTimeout(timeout);

		const text = await response.text();

		return {
			label,
			status: response.status,
			success: response.status === 200,
			response: text.slice(0, 200),
		};
	} catch (error) {
		return {
			label,
			status: 0,
			success: false,
			response: error instanceof Error ? error.message : String(error),
		};
	}
}

function printResult(result: TestResult, httpUserAgent: string) {
	const statusStr =
		result.status === 200
			? `${GREEN}[OK]${NC}`
			: result.status === 429
				? `${RED}[429 RATE LIMITED]${NC}`
				: result.status === 0
					? `${YELLOW}[TIMEOUT/ERROR]${NC}`
					: `${YELLOW}[HTTP ${result.status}]${NC}`;

	console.log(`${statusStr} ${result.label}`);

	if (result.response) {
		// Extract useful info from response
		if (result.status === 429) {
			const retryMatch = result.response.match(/reset after [^"]*/);
			if (retryMatch) {
				console.log(`    ${retryMatch[0]}`);
			}
		} else if (result.status === 200) {
			console.log(`    Response: ${result.response.slice(0, 80)}...`);
		} else {
			console.log(`    ${result.response.slice(0, 150)}`);
		}
	}
}

async function main() {
	const { accessToken, projectId } = await getCredentials();

	console.log(`Project ID: ${projectId}`);
	console.log(`Token: ${accessToken.slice(0, 20)}...`);
	console.log("");

	// Different userAgent values to test in request body
	const bodyUserAgents: (string | undefined)[] = [
		"antigravity",
		"antigravity/1.11.5",
		"Antigravity",
		"pi-coding-agent",
		"google-cloud-sdk",
		"vscode",
		"vscode_cloudshelleditor/0.1",
		"cloudcode",
		"",
		undefined,
	];

	// Different HTTP User-Agent headers to test
	const httpUserAgents = ["antigravity/1.11.5 darwin/arm64", "google-cloud-sdk vscode_cloudshelleditor/0.1"];

	console.log("==============================================");
	console.log("Testing different userAgent combinations...");
	console.log("==============================================");
	console.log("");

	const results: { httpUA: string; bodyUA: string | undefined; result: TestResult }[] = [];

	for (const httpUA of httpUserAgents) {
		console.log(`--- HTTP User-Agent: ${httpUA} ---`);
		console.log("");

		for (const bodyUA of bodyUserAgents) {
			const result = await testRequest(accessToken, projectId, bodyUA, httpUA);
			results.push({ httpUA, bodyUA, result });
			printResult(result, httpUA);

			// Small delay between requests
			await new Promise((r) => setTimeout(r, 1000));
		}

		console.log("");
	}

	// Test with metadata in body
	console.log("==============================================");
	console.log("Testing with additional metadata fields...");
	console.log("==============================================");
	console.log("");

	const metadataResult = await testRequest(accessToken, projectId, "antigravity", "antigravity/1.11.5 darwin/arm64", {
		metadata: {
			ideType: "IDE_UNSPECIFIED",
			platform: "PLATFORM_UNSPECIFIED",
			pluginType: "GEMINI",
		},
	});
	console.log("With metadata field in body:");
	printResult(metadataResult, "antigravity/1.11.5 darwin/arm64");

	console.log("");
	console.log("==============================================");
	console.log("Summary of successful combinations:");
	console.log("==============================================");

	const successful = results.filter((r) => r.result.success);
	if (successful.length === 0) {
		console.log(`${RED}No successful combinations found!${NC}`);
		console.log("Your token may have expired or hit a hard rate limit.");
		console.log("Try re-authenticating with /login google-antigravity");
	} else {
		for (const s of successful) {
			console.log(`${GREEN}OK${NC}: HTTP UA="${s.httpUA}", body.userAgent=${s.bodyUA === undefined ? "(omitted)" : `"${s.bodyUA}"`}`);
		}
	}
}

main().catch((err) => {
	console.error(`${RED}Error:${NC}`, err.message);
	process.exit(1);
});

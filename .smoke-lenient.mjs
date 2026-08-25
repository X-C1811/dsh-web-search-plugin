// Smoke: verify the lenient parser handles Serper's organic[] response.
// Run inside the profile dir so @deepseek-ai deps resolve.
import { CustomSearchProvider } from "dsh-web-search-plugin";

let sentBody = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
	sentBody = JSON.parse(init.body);
	return {
		ok: true,
		status: 200,
		json: async () => ({
			searchParameters: { q: "latest AI news" },
			organic: [
				{ title: "Result A", link: "https://a.example", snippet: "Snippet A", date: "2025-01-01" },
				{ title: "Result B", link: "https://b.example", snippet: "Snippet B", date: "2025-01-02" }
			],
			answerBox: { answer: "A generated answer." }
		})
	};
};

// Serper config: queryParam=q, response is just a lenient hint (any works).
const provider = new CustomSearchProvider("custom-serper", () => ({
	name: "Serper",
	baseURL: "https://google.serper.dev",
	auth: "header",
	authHeader: "X-API-KEY",
	response: "tavily", // user picks any "like" shape; lenient parser handles organic
	queryParam: "q",
	apiKey: "test-key",
	maxResults: 10
}));

const result = await provider.search({ query: "latest AI news" });
console.log("sent body keys:", Object.keys(sentBody).join(","));
console.log("body.q:", sentBody.q);
console.log("sources count:", result.sources.length);
console.log("first source:", JSON.stringify(result.sources[0]));
console.log("content:", result.content);

globalThis.fetch = originalFetch;
if (sentBody.q !== "latest AI news") throw new Error("FAIL: q field missing");
if (result.sources.length !== 2) throw new Error("FAIL: organic not parsed");
if (result.sources[0].url !== "https://a.example") throw new Error("FAIL: link not mapped to url");
if (result.sources[0].snippet !== "Snippet A") throw new Error("FAIL: snippet alias not handled");
if (result.content !== "A generated answer.") throw new Error("FAIL: answerBox not mapped to content");
console.log("LENIENT PARSER OK");
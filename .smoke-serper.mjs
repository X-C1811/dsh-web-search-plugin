// Smoke: verify Serper request body uses `q` and response parses organic[].
// Run inside the profile dir so @deepseek-ai deps resolve.
import { CustomSearchProvider } from "dsh-web-search-plugin";

// Capture the body we'd send.
let sentBody = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
	sentBody = JSON.parse(init.body);
	return {
		ok: true,
		status: 200,
		json: async () => ({
			organic: [
				{ title: "Result A", link: "https://a.example", snippet: "Snippet A" },
				{ title: "Result B", link: "https://b.example", snippet: "Snippet B" }
			],
			answerBox: { answer: "A generated answer." }
		})
	};
};

const provider = new CustomSearchProvider("custom-serper", () => ({
	name: "Serper",
	baseURL: "https://google.serper.dev",
	auth: "header",
	authHeader: "X-API-KEY",
	response: "serper",
	queryParam: "",
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
console.log("SERPER OK");
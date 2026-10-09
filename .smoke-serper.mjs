// Smoke: verify the shipped Serper metadata builds a q request and parses organic[].
// Run inside a profile where dsh-web-search-plugin and its peer dependencies resolve.
import { RestSearchProvider, findProvider } from "dsh-web-search-plugin";

const row = findProvider("serper");
if (!row) throw new Error("Serper provider metadata is missing");

let sentBody;
let sentHeaders;
const originalFetch = globalThis.fetch;
try {
	globalThis.fetch = async (_url, init) => {
		sentBody = JSON.parse(init.body);
		sentHeaders = init.headers;
		return {
			ok: true,
			headers: new Headers(),
			json: async () => ({
				organic: [
					{ title: "Result A", link: "https://a.example", snippet: "Snippet A" },
					{ title: "Result B", link: "https://b.example", snippet: "Snippet B" }
				],
				answerBox: { answer: "A generated answer." }
			})
		};
	};

	const provider = new RestSearchProvider("serper", () => ({ ...row, apiKey: "test-key", maxResults: 10 }));
	const result = await provider.search({ query: "latest AI news" });
	if (sentBody.q !== "latest AI news") throw new Error("Serper q field missing");
	if (sentBody.num !== 10) throw new Error("Serper result count is wrong");
	if (sentHeaders["X-API-KEY"] !== "test-key") throw new Error("Serper API key header missing");
	if (result.sources.length !== 2 || result.sources[0].url !== "https://a.example") throw new Error("Serper organic results were not mapped");
	if (result.content !== "A generated answer.") throw new Error("Serper answer box was not mapped");
	console.log("SERPER OK");
} finally {
	globalThis.fetch = originalFetch;
}

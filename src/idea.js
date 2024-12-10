import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { createExitSignal, staticServer } from "./shared/server.ts";
import { promptGPT } from "./shared/openai.ts";

const app = new Application();
const router = new Router();
const kv = await Deno.openKv();

async function getAllClusters() {
    const clusters = kv.list({ prefix: ["clusters"] });
    const results = [];
    for await (const cluster of clusters) {
        results.push(cluster.value);
    }
    return results;
}

async function saveCluster(clusterId, clusterData) {
    const clusterKey = ["clusters", clusterId];
    await kv.set(clusterKey, clusterData);
}

router.post("/submit", async (context) => {
    try {
        const body = context.request.body({ type: "json" });
        if (!body) throw new Error("Invalid request: No body provided");
        const data = await body.value;
        if (!data || !data.journal) {
            throw new Error("Invalid request: Missing 'journal' field");
        }

        const newIdea = data.journal;

        const clusters = await getAllClusters();

        let matchedCluster = null;

        for (const cluster of clusters) {
            const clusterContent = cluster.ideas.join(". ");
            const comparison = await promptGPT(
                `Does the following new idea fit into this cluster? 
        A fit can mean that it matches the meaning of the cluster ideas, 
        shares the same themes, or complements the big picture.
        Cluster Ideas: ${clusterContent}
        New Idea: ${newIdea}
        Respond with "yes" or "no".`,
                { max_tokens: 10, temperature: 0.5 },
            );

            if (comparison.toLowerCase().includes("yes")) {
                matchedCluster = cluster;
                break;
            }
        }

        if (matchedCluster) {
            matchedCluster.ideas.push(newIdea);
            await saveCluster(matchedCluster.id, matchedCluster);
        } else {
            const clusterId = crypto.randomUUID();
            const newCluster = {
                id: clusterId,
                title: `Cluster ${clusters.length + 1}`,
                ideas: [newIdea],
            };
            await saveCluster(clusterId, newCluster);
        }

        const updatedClusters = await getAllClusters();
        context.response.body = {
            message: "Idea submitted and processed",
            clusters: updatedClusters,
        };
    } catch (error) {
        console.error("Error handling submit request:", error);
        context.response.status = 400;
        context.response.body = {
            error: error.message || "Failed to process the request.",
        };
    }
});

router.post("/clear", async (context) => {
    try {
        const clusters = kv.list({ prefix: ["clusters"] });
        for await (const cluster of clusters) {
            await kv.delete(cluster.key);
        }

        context.response.body = {
            message: "All clusters have been cleared.",
        };
    } catch (error) {
        console.error("Error clearing clusters:", error);
        context.response.status = 500;
        context.response.body = {
            error: "Failed to clear clusters.",
        };
    }
});

app.use(router.routes());
app.use(router.allowedMethods());
app.use(staticServer);

console.log("\nListening on http://localhost:8000");
await app.listen({ port: 8000, signal: createExitSignal() });

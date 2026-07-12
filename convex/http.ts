import { httpRouter } from "convex/server";
import { handleTelegramWebhook } from "./telegram";

const http = httpRouter();

http.route({
	path: "/telegram",
	method: "POST",
	handler: handleTelegramWebhook,
});

export default http;

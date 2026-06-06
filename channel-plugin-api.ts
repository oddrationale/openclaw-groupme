// Keep channel entry imports narrow so bootstrap/discovery paths do not pull
// setup-only GroupMe surfaces into lightweight channel plugin loads.
export { groupmePlugin } from "./src/channel.js";

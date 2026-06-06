// Keep setup entry imports narrow while reusing the same channel plugin setup
// adapter until GroupMe grows a separate setup-only surface.
export { groupmePlugin as groupmeSetupPlugin } from "./src/channel.js";

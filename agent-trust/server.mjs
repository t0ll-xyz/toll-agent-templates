// Run it:  PAY_TO=0xYourWallet npm start
import { serve } from "./seller.mjs";
import { createApp } from "./app.mjs";

await serve(createApp);

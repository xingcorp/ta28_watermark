import { generateEconomicUpdatePost } from "./prompts.mjs";

(async () => {
  try {
    let messageText = `🔴 Hopes for renewed peace talks between Russia and Ukraine are rekindling. Is the gold price surge myth about to end? ↗️  
———  
⚫Gold prices may be nearing a peak in the current upcycle and could peak if peace talks between Russia and Ukraine commence.  

⚫Despite reaching a high of $2,940/ounce, gold has slightly declined and may continue this trend.  

⚫__Morgan Stanley__ forecasts gold prices will drop to $2,700/ounce by year-end, potentially falling to $2,400/ounce if demand weakens and supply increases. Central banks remain the main driver, but buying pace has slowed.  

⚫Factors affecting gold prices include interest rates, the USD index, central bank reserves, ETFs, and inflation. Morgan Stanley estimates fair gold price at $2,000/ounce based on 5-year data analysis.  

⚫While central bank gold purchases remain strong, the buying pace may decrease to 850 tons by 2025.  

🛫__If Russia and Ukraine reach a peace agreement, gold prices could sharply decline.__  
————  
⬇️Get market news updates via the app today!  
✅️ Website (VNWallstreet)  
📱 iOS APP   
📱 Android APP`;

    const bypassKeywords = ["insiderfx", "vnwallstreet"];
    if (
      bypassKeywords.some((keyword) =>
        messageText.toLowerCase().includes(keyword)
      )
    ) {
      console.log(`Bypassing message containing keyword`);
    }
  } catch (error) {
    console.log(error);
  }
})();

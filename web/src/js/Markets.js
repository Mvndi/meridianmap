import L from "leaflet";
import { S } from "./Squaremap.js";

const MARKETS_URL = "tiles/markets.json";
const REFRESH_MS = 15_000;
const MAX_LISTINGS = 150;
const MARKET_ICON = L.icon({
    iconUrl: "images/icon/market.png",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    tooltipAnchor: [0, -12],
});
const nice = (value) =>
    String(value || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
const num = (value) => Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
const mapWorld = (world) => world.replace(":", "_");

const DETAIL_LABELS = {
    equipmentId: "Equipment ID",
    variation: "Variation",
    smithingMaterial: "Smithing material",
    grade: "Smithing grade",
    sharpness: "Smithing sharpness",
    quality: "Smithing quality",
    quenching: "Quenching level",
    upgrade: "Equipment upgrade",
    trimPattern: "Armor trim",
    trimMaterial: "Trim material",
    durability: "Durability",
};
const RAW_DETAILS = new Set(["equipmentId", "variation", "durability"]);
const detailValue = (key, value) => {
    if (typeof value === "number") return num(value);
    return RAW_DETAILS.has(key) ? String(value) : nice(String(value).replace(/^minecraft:/, ""));
};

const itemName = (offer) => (offer.itemName === offer.item.toUpperCase() ? nice(offer.item) : offer.itemName);

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

class Markets {
    constructor() {
        this.markets = [];
        this.expandedMarkets = new Set();
        this.loaded = false;
        this.available = false;
        this.failed = false;
        this.layer = new L.LayerGroup();
        this.layer.id = "markets_layer";
        this.layer.order = 50;
        this.input = document.getElementById("market-search");
        this.list = document.getElementById("market-list");
        this.meta = document.getElementById("market-meta");
        this.count = document.getElementById("market-count");
        this.input.addEventListener("input", () => this.render());
        this.load();
        setInterval(() => this.load(), REFRESH_MS);
    }

    async load() {
        try {
            const response = await fetch(MARKETS_URL, { cache: "no-store" });
            if (!response.ok) throw new Error(String(response.status));
            const json = await response.json();
            this.markets = Array.isArray(json.markets) ? json.markets : [];
            this.available = json.available === true;
            this.loaded = true;
            this.failed = false;
            this.draw();
        } catch {
            this.failed = true;
        }
        this.render();
    }

    attach() {
        S.layerControl.removeOverlay(this.layer);
        S.layerControl.addOverlay("Markets", this.layer, false);
        this.draw();
    }

    draw() {
        this.layer.clearLayers();
        const world = S.worldList?.curWorld;
        if (!world?.zoom) return;
        for (const market of this.markets) {
            for (const plot of market.plots) {
                if (mapWorld(plot.world) === world.name) this.drawPlot(market, plot);
            }
        }
    }

    drawPlot(market, plot) {
        const end = S.toLatLng(plot.x + plot.size, plot.z + plot.size);
        L.rectangle([S.toLatLng(plot.x, plot.z), end], {
            color: "#ffd700",
            weight: 2,
            fillColor: "#ffd700",
            fillOpacity: 0.22,
        })
            .bindTooltip(`${market.town} market · ${market.listings.length} listings`)
            .on("click", () => this.focus(market, plot))
            .addTo(this.layer);
        L.marker(this.center(plot), {
            icon: MARKET_ICON,
            title: `${market.town} market`,
            alt: `${market.town} market`,
        })
            .bindTooltip(`${market.town} market`)
            .on("click", () => this.focus(market, plot))
            .addTo(this.layer);
    }

    center(plot) {
        return S.toLatLng(plot.x + plot.size / 2, plot.z + plot.size / 2);
    }

    matches(market, offer, words) {
        const text = [
            market.town,
            offer?.item,
            offer?.itemName,
            offer?.seller,
            ...Object.values(offer?.details ?? {}),
            ...(offer?.lore ?? []),
            ...(offer?.enchants ?? []),
        ]
            .join(" ")
            .toLowerCase()
            .replace(/_/g, " ");
        return words.every((word) => text.includes(word));
    }

    visibleMarkets() {
        return this.markets.filter((market) =>
            market.plots.some((plot) => S.worldList?.worlds.has(mapWorld(plot.world))),
        );
    }

    results() {
        const words = this.input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return this.visibleMarkets()
            .map((market) => ({
                market,
                offers: market.listings
                    .filter((offer) => this.matches(market, offer, words))
                    .sort((a, b) => a.price / a.amount - b.price / b.amount),
            }))
            .filter(({ market, offers }) => offers.length || this.matches(market, null, words))
            .sort((a, b) => a.market.town.localeCompare(b.market.town));
    }

    render() {
        for (const group of this.list.querySelectorAll(".market-group")) {
            if (group.open) this.expandedMarkets.add(group.dataset.marketId);
            else this.expandedMarkets.delete(group.dataset.marketId);
        }
        const results = this.results();
        this.count.textContent = num(this.visibleMarkets().length);
        this.meta.textContent = this.summary(results);
        this.list.replaceChildren(...results.map((result) => this.createMarket(result)));
    }

    summary(results) {
        if (this.failed) return "Market information is unavailable. Retrying shortly.";
        if (!this.loaded) return "Loading markets…";
        if (!this.available) return "Market information is unavailable.";
        if (!this.visibleMarkets().length) return "No town markets yet.";
        if (!results.length) return "No markets or listings match your search.";
        const listings = results.reduce((total, result) => total + result.offers.length, 0);
        return `${num(listings)} matching listings · expand a market to browse`;
    }

    createMarket({ market, offers }) {
        const group = element("details", "market-group");
        group.dataset.marketId = market.id;
        group.open = this.expandedMarkets.has(market.id);
        const heading = element("summary", "market-heading");
        heading.append(element("span", "market-name", `${market.town} market`));
        heading.append(element("span", "chip", `${offers.length} listings`));
        group.append(heading, this.createMarketBody(market, offers));
        group.addEventListener("toggle", () => {
            if (!group.isConnected) return;
            if (group.open) this.expandedMarkets.add(market.id);
            else this.expandedMarkets.delete(market.id);
        });
        return group;
    }

    createMarketBody(market, offers) {
        const body = element("div", "market-listings");
        const locate = element("button", "market-locate", "Show market on map");
        locate.type = "button";
        locate.addEventListener("click", () => this.focus(market, this.visiblePlot(market)));
        body.append(locate);
        body.append(...offers.slice(0, MAX_LISTINGS).map((offer) => this.createRow({ market, offer })));
        if (!offers.length) body.append(element("p", "empty", "No active listings."));
        if (offers.length > MAX_LISTINGS)
            body.append(
                element("p", "meta", `Showing the first ${MAX_LISTINGS} listings. Refine your search to find more.`),
            );
        return body;
    }

    createRow({ market, offer }) {
        const row = element("button", "srow");
        row.type = "button";
        row.append(element("span", "s-item", offer ? itemName(offer) : `${market.town} market`));
        row.append(
            element("span", "s-price", offer ? `${num(offer.price)} g / ${offer.amount}` : "No active listings"),
        );
        row.append(element("span", "s-who", [market.town, offer?.seller].filter(Boolean).join(" · ")));
        if (offer?.enchants.length) row.append(element("span", "s-who", offer.enchants.map(nice).join(", ")));
        if (offer) row.append(this.itemDetails(offer));
        row.addEventListener("click", (event) => {
            event.stopPropagation();
            this.focus(market, this.visiblePlot(market), offer);
        });
        return row;
    }

    itemDetails(offer) {
        const details = element("span", "market-item-details");
        for (const [key, label] of Object.entries(DETAIL_LABELS)) {
            const value = offer.details?.[key];
            if (value == null) continue;
            details.append(element("span", "market-item-property", `${label}: ${detailValue(key, value)}`));
        }
        if (offer.lore?.length) {
            const lore = element("span", "market-item-lore");
            for (const line of offer.lore) lore.append(element("span", "market-lore-line", line || "\u00a0"));
            details.append(lore);
        }
        return details;
    }

    visiblePlot(market) {
        return (
            market.plots.find((plot) => mapWorld(plot.world) === S.worldList.curWorld.name) ??
            market.plots.find((plot) => S.worldList.worlds.has(mapWorld(plot.world)))
        );
    }

    focus(market, plot, offer) {
        if (!plot || !S.worldList.worlds.has(mapWorld(plot.world))) return;
        S.worldList.showWorld(mapWorld(plot.world), () => {
            const at = this.center(plot);
            S.map.setView(at, S.worldList.curWorld.zoom.max + 1, { animate: false });
            L.popup({
                className: "m-popup",
                offset: [0, -2],
                maxHeight: Math.max(120, S.map.getSize().y - 100),
            })
                .setLatLng(at)
                .setContent(this.card(market, plot, offer))
                .openOn(S.map);
        });
    }

    card(market, plot, offer) {
        const card = element("div", "market-card");
        card.append(element("strong", "c-head", `${market.town} market`));
        if (offer) {
            card.append(element("p", "c-line", `${offer.amount}× ${itemName(offer)} · ${num(offer.price)} g`));
            card.append(element("p", "c-line", `Seller: ${offer.seller}`));
            card.append(this.itemDetails(offer));
            if (offer.enchants.length) card.append(element("p", "c-line", offer.enchants.map(nice).join(", ")));
        }
        card.append(element("p", "c-line", `${market.listings.length} active listings`));
        card.append(
            element("p", "c-line", "Browse with /market in game. Purchases follow market and trade-route rules."),
        );
        card.append(element("p", "c-line mono", `X ${plot.x + plot.size / 2}  Z ${plot.z + plot.size / 2}`));
        return card;
    }
}

export { Markets };

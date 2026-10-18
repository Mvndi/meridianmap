import L from "leaflet";
import { S } from "./Squaremap.js";

const MARKETS_URL = "tiles/markets.json";
const REFRESH_MS = 15_000;
const MAX_ROWS = 150;
const nice = (value) =>
    String(value || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
const num = (value) => Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
const mapWorld = (world) => world.replace(":", "_");

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
        L.circleMarker(this.center(plot), {
            radius: 5,
            weight: 2,
            color: "#1a1403",
            fillColor: "#ffd700",
            fillOpacity: 1,
        })
            .bindTooltip(`${market.town} market`)
            .on("click", () => this.focus(market, plot))
            .addTo(this.layer);
    }

    center(plot) {
        return S.toLatLng(plot.x + plot.size / 2, plot.z + plot.size / 2);
    }

    matches(market, offer, words) {
        const text = [market.town, offer?.item, offer?.itemName, offer?.seller, ...(offer?.enchants ?? [])]
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
        const results = [];
        for (const market of this.visibleMarkets()) {
            if (!market.listings.length && this.matches(market, null, words)) results.push({ market });
            for (const offer of market.listings) {
                if (this.matches(market, offer, words)) results.push({ market, offer });
            }
        }
        return results.sort(
            (a, b) =>
                (a.offer?.price ?? Infinity) / (a.offer?.amount ?? 1) -
                (b.offer?.price ?? Infinity) / (b.offer?.amount ?? 1),
        );
    }

    render() {
        const results = this.results();
        this.count.textContent = num(this.visibleMarkets().length);
        this.meta.textContent = this.summary(results.length);
        this.list.replaceChildren(...results.slice(0, MAX_ROWS).map((result) => this.createRow(result)));
    }

    summary(count) {
        if (this.failed) return "Market information is unavailable. Retrying shortly.";
        if (!this.loaded) return "Loading markets…";
        if (!this.available) return "Market information is unavailable.";
        if (!this.visibleMarkets().length) return "No town markets yet.";
        if (!count) return "No markets or listings match your search.";
        const listings = this.visibleMarkets().reduce((total, market) => total + market.listings.length, 0);
        return `${num(listings)} active listings · cheapest per item first${count > MAX_ROWS ? ` · first ${MAX_ROWS} results` : ""}`;
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
        row.addEventListener("click", (event) => {
            event.stopPropagation();
            this.focus(market, this.visiblePlot(market), offer);
        });
        return row;
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
            S.map.setView(at, S.worldList.curWorld.zoom.max + 1);
            L.popup({ className: "m-popup", offset: [0, -2] })
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

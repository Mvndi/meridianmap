const SERVER_ADDRESS = "mc.mvndicraft.net";
const STATUS_URL = `https://api.mcsrvstat.us/2/${SERVER_ADDRESS}`;
const STATUS_INTERVAL_MS = 10000;
const STATUS_TIMEOUT_MS = 5000;

class Navbar {
    constructor() {
        this.toggle = document.getElementById("nav-toggle");
        this.menu = document.getElementById("site-navigation");
        this.toggle.addEventListener("click", () => this.setOpen(this.toggle.getAttribute("aria-expanded") !== "true"));
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") this.setOpen(false);
        });
        document.addEventListener("click", (event) => {
            if (!event.target.closest("#topbar")) this.setOpen(false);
        });
        document.getElementById("copy-server").addEventListener("click", () => this.copyAddress());
        this.updateServerStatus();
        setInterval(() => this.updateServerStatus(), STATUS_INTERVAL_MS);
    }

    async updateServerStatus() {
        try {
            const response = await fetch(STATUS_URL, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
            if (!response.ok) throw new Error("Server status request failed");
            const data = await response.json();
            const players = data.players?.online;
            this.showServerStatus(Number.isInteger(players) && players >= 0 ? players : 0);
        } catch {
            this.showServerStatus(0);
        }
    }

    showServerStatus(players) {
        document.getElementById("nav-online").textContent = `${players} Online players`;
        document.querySelector(".online-dot").classList.toggle("is-online", players > 0);
    }

    setOpen(open) {
        this.toggle.setAttribute("aria-expanded", String(open));
        this.menu.classList.toggle("nav-open", open);
    }

    async copyAddress() {
        const status = document.getElementById("nav-status");
        try {
            await navigator.clipboard.writeText(SERVER_ADDRESS);
            status.textContent = `Copied ${SERVER_ADDRESS}`;
            document.getElementById("copy-server").title = `Copied ${SERVER_ADDRESS}`;
        } catch {
            status.textContent = `Server address: ${SERVER_ADDRESS}`;
        }
    }
}

export { Navbar };

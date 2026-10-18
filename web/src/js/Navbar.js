const SERVER_ADDRESS = "mc.mvndicraft.net";

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

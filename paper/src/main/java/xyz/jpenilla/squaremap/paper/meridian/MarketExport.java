package xyz.jpenilla.squaremap.paper.meridian;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.checkerframework.checker.nullness.qual.Nullable;
import xyz.jpenilla.squaremap.common.Logging;
import xyz.jpenilla.squaremap.common.util.Util;

public final class MarketExport implements Runnable {
    private static final String PLUGIN = "MvndiTowny";
    private static final String SNAPSHOT = "net.mvndicraft.mvnditowny.market.map.MarketMapSnapshot";
    private static final String CAPTURE = "capture";
    private static final String TILES = "tiles";
    private static final String FILE_NAME = "markets.json";
    private static final String LEGACY_FILE = "shops.json";
    private static final String CLEANUP_ERROR = "Could not remove obsolete chest-shop map export";
    private static final String TEMP_PREFIX = "markets-";
    private static final String TEMP_SUFFIX = ".tmp";
    private static final String AVAILABLE = "available";
    private static final String MARKETS = "markets";
    private static final String READ_ERROR = "Could not read MvndiTowny markets for the map";
    private static final String WRITE_ERROR = "Could not write market map data";
    private final Path file;
    private boolean warned;
    private CompletableFuture<Void> write = CompletableFuture.completedFuture(null);

    public MarketExport(Path webDirectory) {
        this.file = webDirectory.resolve(TILES).resolve(FILE_NAME);
        this.removeLegacyExport();
    }

    private void removeLegacyExport() {
        try {
            Files.deleteIfExists(this.file.resolveSibling(LEGACY_FILE));
        } catch (IOException exception) {
            Logging.logger().warn(CLEANUP_ERROR, exception);
        }
    }

    @Override
    public void run() {
        final String json = Util.gson().toJson(this.capture());
        this.write = this.write.handle((ignored, failure) -> null).thenRunAsync(() -> this.writeSnapshot(json));
    }

    private Object capture() {
        final @Nullable Plugin plugin = Bukkit.getPluginManager().getPlugin(PLUGIN);
        if (plugin == null || !plugin.isEnabled()) {
            return Map.of(AVAILABLE, false, MARKETS, List.of());
        }
        try {
            final Class<?> snapshot = Class.forName(SNAPSHOT, true, plugin.getClass().getClassLoader());
            return snapshot.getMethod(CAPTURE).invoke(null);
        } catch (ReflectiveOperationException | LinkageError exception) {
            if (!this.warned) {
                this.warned = true;
                Logging.logger().warn(READ_ERROR, exception);
            }
            return Map.of(AVAILABLE, false, MARKETS, List.of());
        }
    }

    private void writeSnapshot(String json) {
        try {
            Files.createDirectories(this.file.getParent());
            this.replaceSnapshot(json);
        } catch (IOException exception) {
            Logging.logger().warn(WRITE_ERROR, exception);
        }
    }

    private void replaceSnapshot(String json) throws IOException {
        final Path temporary = Files.createTempFile(this.file.getParent(), TEMP_PREFIX, TEMP_SUFFIX);
        try {
            Files.writeString(temporary, json, StandardCharsets.UTF_8);
            Files.move(temporary, this.file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }
}

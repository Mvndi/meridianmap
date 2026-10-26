package xyz.jpenilla.squaremap.common.task;

import com.google.inject.Inject;
import com.google.inject.Provider;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ForkJoinPool;
import net.kyori.adventure.text.flattener.ComponentFlattener;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.BlockTags;
import net.minecraft.tags.ItemTags;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.Vec3;
import org.checkerframework.checker.nullness.qual.NonNull;
import org.checkerframework.checker.nullness.qual.Nullable;
import org.checkerframework.framework.qual.DefaultQualifier;
import xyz.jpenilla.squaremap.api.HtmlComponentSerializer;
import xyz.jpenilla.squaremap.common.AbstractPlayerManager;
import xyz.jpenilla.squaremap.common.ServerAccess;
import xyz.jpenilla.squaremap.common.config.ConfigManager;
import xyz.jpenilla.squaremap.common.config.WorldConfig;
import xyz.jpenilla.squaremap.common.httpd.JsonCache;
import xyz.jpenilla.squaremap.common.util.Util;
import xyz.jpenilla.squaremap.common.util.EntityScheduler;

@DefaultQualifier(NonNull.class)
public final class UpdatePlayers implements Runnable {
    private static final String NAME = "name";
    private static final String UUID_KEY = "uuid";
    private static final String UUID_SEPARATOR = "-";
    private static final String EMPTY = "";
    private static final String DISPLAY_NAME = "display_name";
    private static final String WORLD = "world";
    private static final String X = "x";
    private static final String Y = "y";
    private static final String Z = "z";
    private static final String YAW = "yaw";
    private static final String ARMOR = "armor";
    private static final String HEALTH = "health";
    private static final String PLAYERS = "players";
    private static final String MAX = "max";
    private static final String ONLINE = "online";
    private static final String VISIBLE = "visible";
    private static final String HIDDEN = "hidden";
    private static final int ONLINE_INDEX = 0;
    private static final int HIDDEN_INDEX = 1;
    private static final int COUNT_FIELDS = 2;
    private static final long MAX_SNAPSHOT_AGE = 2;
    private static final String JSON_PATH = "/tiles/players.json";

    private final Provider<ComponentFlattener> flattener;
    private final AbstractPlayerManager playerManager;
    private final ServerAccess serverAccess;
    private final ConfigManager configManager;
    private final JsonCache jsonCache;
    private final EntityScheduler entityScheduler;
    private final Map<UUID, PlayerSnapshot> snapshots = new ConcurrentHashMap<>();
    private long updateSequence;
    private @Nullable Map<String, Object> lastData = null;

    @Inject
    private UpdatePlayers(
        final Provider<ComponentFlattener> flattener,
        final AbstractPlayerManager playerManager,
        final ServerAccess serverAccess,
        final ConfigManager configManager,
        final JsonCache jsonCache,
        final EntityScheduler entityScheduler
    ) {
        this.flattener = flattener;
        this.playerManager = playerManager;
        this.serverAccess = serverAccess;
        this.configManager = configManager;
        this.jsonCache = jsonCache;
        this.entityScheduler = entityScheduler;
    }

    @Override
    public void run() {
        final @Nullable Map<String, Object> prev = this.lastData;
        final Map<String, Object> data = this.collectData();
        this.lastData = data;

        ForkJoinPool.commonPool().execute(() -> {
            if (prev == null || !prev.equals(data)) {
                final String json = Util.gson().toJson(data);
                this.jsonCache.put(JSON_PATH, json);
            }
        });
    }

    private Map<String, Object> collectData() {
        final List<Object> players = new ArrayList<>();
        final int[] counts = new int[COUNT_FIELDS];

        final long sequence = ++this.updateSequence;
        final List<ServerPlayer> onlinePlayers = new ArrayList<>();
        this.serverAccess.levels().forEach(world -> onlinePlayers.addAll(world.players()));
        final List<UUID> onlineIds = onlinePlayers.stream().map(ServerPlayer::getUUID).toList();
        this.snapshots.keySet().retainAll(onlineIds);
        for (final ServerPlayer player : onlinePlayers) {
            this.entityScheduler.scheduleFor(player, () -> this.capturePlayer(player, sequence));
            final @Nullable PlayerSnapshot snapshot = this.snapshots.get(player.getUUID());
            if (snapshot == null || sequence - snapshot.sequence() > MAX_SNAPSHOT_AGE) {
                continue;
            }
            counts[ONLINE_INDEX]++;
            if (snapshot.hidden()) {
                counts[HIDDEN_INDEX]++;
            }
            if (!snapshot.entry().isEmpty()) {
                players.add(snapshot.entry());
            }
        }

        final Map<String, Object> map = new HashMap<>();

        map.put(ONLINE, counts[ONLINE_INDEX]);
        map.put(VISIBLE, counts[ONLINE_INDEX] - counts[HIDDEN_INDEX]);
        map.put(HIDDEN, counts[HIDDEN_INDEX]);
        map.put(PLAYERS, players);
        map.put(MAX, this.serverAccess.maxPlayers());

        return map;
    }

    private void capturePlayer(final ServerPlayer player, final long sequence) {
        final WorldConfig config = this.configManager.worldConfig(player.level());
        if ((config.PLAYER_TRACKER_HIDE_SPECTATORS && player.gameMode.getGameModeForPlayer() == GameType.SPECTATOR)
            || this.playerManager.otherwiseHidden(player)) {
            this.snapshots.remove(player.getUUID());
            return;
        }
        final boolean hidden = this.isHidden(player, config);
        final Map<String, Object> entry = hidden && !config.PLAYER_TRACKER_LIST_HIDDEN
            ? Map.of() : this.playerEntry(player, config, hidden);
        this.snapshots.put(player.getUUID(), new PlayerSnapshot(sequence, hidden, Map.copyOf(entry)));
    }

    private boolean isHidden(final ServerPlayer player, final WorldConfig config) {
        return !config.MAP_ENABLED
            || !config.PLAYER_TRACKER_ENABLED
            || (config.PLAYER_TRACKER_HIDE_INVISIBLE && player.isInvisible())
            || (config.PLAYER_TRACKER_HIDE_MAP_INVISIBILITY_EQUIPMENT && hasMapInvisibilityItemEquipped(player))
            || (config.PLAYER_TRACKER_HIDE_UNDER_ROOF && underRoof(player.level(), player))
            || this.playerManager.hidden(player);
    }

    private Map<String, Object> playerEntry(final ServerPlayer player, final WorldConfig config, final boolean hidden) {
        final Map<String, Object> entry = this.playerIdentity(player, config);
        if (hidden) {
            entry.put(HIDDEN, true);
            return entry;
        }
        this.addPosition(entry, player);
        if (config.PLAYER_TRACKER_NAMEPLATE_SHOW_ARMOR) {
            entry.put(ARMOR, armorPoints(player));
        }
        if (config.PLAYER_TRACKER_NAMEPLATE_SHOW_HEALTH) {
            entry.put(HEALTH, (int) player.getHealth());
        }
        return entry;
    }

    private Map<String, Object> playerIdentity(final ServerPlayer player, final WorldConfig config) {
        final Map<String, Object> entry = new HashMap<>();
        entry.put(NAME, player.getGameProfile().name());
        entry.put(UUID_KEY, player.getUUID().toString().replace(UUID_SEPARATOR, EMPTY));
        if (config.PLAYER_TRACKER_USE_DISPLAY_NAME) {
            final HtmlComponentSerializer serializer = HtmlComponentSerializer.withFlattener(this.flattener.get());
            entry.put(DISPLAY_NAME, serializer.serialize(this.playerManager.displayName(player)));
        }
        return entry;
    }

    private void addPosition(final Map<String, Object> entry, final ServerPlayer player) {
        final Vec3 position = player.position();
        entry.put(WORLD, Util.levelWebName(player.level()));
        entry.put(X, Mth.floor(position.x()));
        entry.put(Y, Mth.floor(position.y()));
        entry.put(Z, Mth.floor(position.z()));
        entry.put(YAW, Math.round(player.getYHeadRot()));
    }

    private record PlayerSnapshot(long sequence, boolean hidden, Map<String, Object> entry) {
    }

    /**
     * Meridian: is there a solid block anywhere above the player's head? Leaves, water and plants don't count, so
     * standing under a tree or swimming keeps you on the map; a roof, a cave or an overhang hides you.
     */
    private static boolean underRoof(final ServerLevel level, final ServerPlayer player) {
        final BlockPos head = BlockPos.containing(player.getEyePosition());
        final int top = level.getHeight(Heightmap.Types.MOTION_BLOCKING, head.getX(), head.getZ());
        final BlockPos.MutableBlockPos pos = head.mutable();
        for (int y = head.getY() + 1; y < top; y++) {
            pos.setY(y);
            final BlockState state = level.getBlockState(pos);
            if (state.isAir() || state.is(BlockTags.LEAVES)) {
                continue;
            }
            if (state.blocksMotion()) {
                return true;
            }
        }
        return false;
    }

    private static int armorPoints(final ServerPlayer player) {
        final @Nullable AttributeInstance attribute = player.getAttribute(Attributes.ARMOR);
        return attribute == null ? 0 : (int) attribute.getValue();
    }

    // Copied from MapItemSavedData#hasMapInvisibilityItemEquipped(Player)
    private static boolean hasMapInvisibilityItemEquipped(final Player player) {
        for (final EquipmentSlot slot : EquipmentSlot.values()) {
            if (slot != EquipmentSlot.MAINHAND && slot != EquipmentSlot.OFFHAND && player.getItemBySlot(slot).is(ItemTags.MAP_INVISIBILITY_EQUIPMENT)) {
                return true;
            }
        }
        return false;
    }
}

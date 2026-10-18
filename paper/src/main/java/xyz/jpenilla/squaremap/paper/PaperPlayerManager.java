package xyz.jpenilla.squaremap.paper;

import com.google.inject.Inject;
import com.google.inject.Singleton;
import net.kyori.adventure.text.Component;
import net.minecraft.server.level.ServerPlayer;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.metadata.MetadataValue;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;
import org.checkerframework.checker.nullness.qual.NonNull;
import org.checkerframework.framework.qual.DefaultQualifier;
import xyz.jpenilla.squaremap.common.AbstractPlayerManager;
import xyz.jpenilla.squaremap.common.ServerAccess;

@DefaultQualifier(NonNull.class)
@Singleton
public final class PaperPlayerManager extends AbstractPlayerManager {
    private static final String VANISHED_METADATA = "vanished";
    private static final String NPC_METADATA = "NPC";
    public final NamespacedKey hiddenKey;

    @Inject
    private PaperPlayerManager(
        final JavaPlugin plugin,
        final ServerAccess serverAccess
    ) {
        super(serverAccess);
        this.hiddenKey = new NamespacedKey(plugin, "hidden");
    }

    @Override
    protected boolean persistentHidden(final ServerPlayer player) {
        return pdc(player).getOrDefault(this.hiddenKey, PersistentDataType.BYTE, (byte) 0) != (byte) 0;
    }

    @Override
    protected void persistentHidden(final ServerPlayer player, final boolean value) {
        pdc(player).set(this.hiddenKey, PersistentDataType.BYTE, (byte) (value ? 1 : 0));
    }

    @Override
    public boolean otherwiseHidden(final ServerPlayer player) {
        final Player bukkit = player.getBukkitEntity();
        return bukkit.hasMetadata(NPC_METADATA) || vanished(bukkit);
    }

    /** Meridian: the "vanished" metadata vanish plugins set (SuperVanish, PremiumVanish, EssentialsX, Staff++ and others). */
    private static boolean vanished(final Player player) {
        for (final MetadataValue value : player.getMetadata(VANISHED_METADATA)) {
            if (value.asBoolean()) {
                return true;
            }
        }
        return false;
    }

    @Override
    public Component displayName(final ServerPlayer player) {
        return player.getBukkitEntity().displayName();
    }

    private static PersistentDataContainer pdc(final ServerPlayer player) {
        return player.getBukkitEntity().getPersistentDataContainer();
    }
}

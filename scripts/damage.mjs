import { findCompendiumItem } from './compendium.mjs'
import { postCard, postNotice, postRoll } from './hda/chat.mjs' // HDA
import { settings, SYSTEM_ID } from './settings.mjs'
import { evaluateFormula } from './utils.mjs'

export class Damage {

    /**
     * @description Apply damage to several tokens
     * @param {String[]} targets Array of Id of the targeted tokens
     * @param {Number} damage Positive number
     * @param {Object} [options] HDA: see applyToTarget
     */
    static async applyToTargets(targets, damage, options = {}) {
        for (const target of targets) {
            const data = await this.applyToTarget(target, damage, options);
            await this._showDetails(data);
        };
    }

    /**
     * @description Apply damage to one token
     * @param {*} tokenId Id of one token
     * @param {*} damage Amount of damaage
     * @param {Object} [options]
     * @param {'STR'|'WIL'} [options.target] HDA: `WIL` sai direto da VON, sem passar pelos PG
     * @param {boolean} [options.ignoreArmor] HDA: não subtrai a Armadura
     * @returns actor + old and new values
     */
    static async applyToTarget(tokenId, damage, { target = 'STR', ignoreArmor = false } = {}) {
        const token = canvas.scene.tokens.get(tokenId);

        // HDA: Armadura não reduz dano de VON, salvo pela configuração.
        const armorApplies = !ignoreArmor && (target !== 'WIL' || settings.get('hda-will-damage-armor'));
        const armor = armorApplies ? token.actor.system.armor : 0;

        if (target === 'WIL') {
            const wil = token.actor.system.abilities.WIL.value;
            const dmg = Math.max(0, damage - armor);
            const newWil = Math.max(0, wil - dmg);
            await token.actor.update({ 'system.abilities.WIL.value': newWil });
            return { token, target, dmg, damage, armor, wil, newWil };
        }

        const hp = token.actor.system.hp.value;
        const str = token.actor.system.abilities.STR.value;

        let { dmg, newHp, newStr } = this._calculateHpAndStr(damage, armor, hp, str);
        if (newStr < 0) newStr = 0; // cannot drop below being dead

        await token.actor.update({ 'system.hp.value': newHp, 'system.abilities.STR.value': newStr });

        return { token, target, dmg, damage, armor, hp, str, newHp, newStr };
    }

    /**
     * HDA: posta o cartão de dano. Substitui o `dmg-roll-card.hbs`.
     * @param {Actor} actor quem causa o dano
     * @param {Roll} roll
     * @param {Object} options
     * @param {String} options.label
     * @param {String[]} [options.targets] ids de token; por padrão, os alvos do usuário
     * @param {'STR'|'WIL'} [options.ability] o que o dano atinge
     * @param {boolean} [options.ignoreArmor]
     */
    static async postRoll(actor, roll, { label, targets, ability = 'STR', ignoreArmor = false }) {
        const tokens = targets
            ? targets.map((id) => canvas.scene?.tokens.get(id)).filter(Boolean)
            : Array.from(game.user.targets).map((token) => token.document);
        return postRoll(roll, 'damage', {
            label,
            formula: roll.formula,
            total: roll.total,
            targets: tokens.map((token) => token.id).join(';'),
            targetsLabel: tokens.map((token) => token.name).join(', '),
            ability,
            willDamage: ability === 'WIL',
            ignoreArmor,
            willAttack: actor.type === 'npc' && ability === 'STR' ? actor.system.willAttack : '',
        }, { actor });
    }

    /**
     * @description Apply damage to a target token based on the token's id
     * @param {*} event
     * @param {*} html
     * @param {*} data
     */
    static onClickChatMessageApplyButton(event, html, data) {
        const button = event.currentTarget;
        const targets = button.dataset.targets;

        let targetsList = targets.split(';');

        // Shift Click allow to target the targeted tokens
        if (event.shiftKey) {
            for (let index = 0; index < targetsList.length; index++) {
                const target = targetsList[index];
                const token = canvas.scene.tokens.get(target).object;
                const releaseOthers = (index == 0 ? (!token.isTargeted ? true : false) : false);
                const targeted = !token.isTargeted;
                token.setTarget(targeted, { releaseOthers: releaseOthers });
            }
        }
        // Apply damage to targets
        else {
            if (targets !== undefined) {
                // HDA: o valor vem do cartão; o tema não tem `.dice-total`.
                const dmg = parseInt(button.dataset.amount);
                this.applyToTargets(targetsList, dmg, {
                    target: button.dataset.ability,
                    ignoreArmor: button.dataset.ignoreArmor === 'true',
                });
            }
        }
    }

    /**
     * @description Damage are reduced by armor, then apply to HP, and then to STR if not enough HP
     * @param {*} damage
     * @param {*} armor
     * @param {*} hp
     * @param {*} str
     * @returns damage done, new HP value and STR value
     */
    static _calculateHpAndStr(damage, armor, hp, str) {
        let dmg = damage - armor;
        if (dmg < 0) dmg = 0;

        let newHp;
        let newStr = str;
        if (dmg <= hp) {
            newHp = hp - dmg;
            if (newHp < 0) newHp = 0;
        }
        else {
            newHp = 0;
            newStr = str - (dmg - hp);
        }

        return { dmg, newHp, newStr };
    }

    /**
     * Show chat message details of damage done for a token
     * @param data
     * @private
     */
    static async _showDetails(data) {
        const { token, target, dmg, damage, armor } = data;
        const localize = (key) => game.i18n.localize(key);
        const changes = [{ label: `${localize('CAIRN.Damage')} (${damage} − ${armor})`, from: damage, to: dmg }];

        // HDA: dano de VON. Ao chegar a 0, Delirante.
        if (target === 'WIL') {
            const { wil, newWil } = data;
            changes.push({ label: localize('WIL'), from: wil, to: newWil });
            return postCard('damage-applied', { changes, delirious: newWil === 0 }, { token });
        }

        const { hp, str, newHp, newStr } = data;
        if (str == 0) return postCard('damage-applied', { dead: true }, { token });

        if (newHp !== hp) changes.push({ label: localize('CAIRN.HitProtection'), from: hp, to: newHp });
        if (newStr !== str) changes.push({ label: localize('STR'), from: str, to: newStr });

        const dead = newStr < str && newStr === 0;
        const strSave = newStr < str && newStr !== 0;
        const scars = newStr >= str && newHp === 0 && hp !== 0;
        await postCard('damage-applied', { changes, dead, strSave, scars }, { token });
        if (scars) await this._rollScarsTable(dmg, token);
    }

    static async _rollScarsTable(damage, token) {
        const table = await findCompendiumItem(`${SYSTEM_ID}.utils`, "Scars");
        const roll = await new Roll(damage.toString()).evaluate();
        const { results } = await table.draw({ roll, displayChat: false }); // HDA: cartão do tema
        if (!results.length) return;
        await postNotice({ title: game.i18n.localize('CAIRN.Scars'), html: await results[0].getHTML() }, { token });
    }

    static async _rollStrSave(token, html) {
        const roll = await evaluateFormula("d20cs<=@STR", token.actor.getRollData());
        const label = game.i18n.format("CAIRN.Save", { key: game.i18n.localize("STR") });
        const rolled = roll.terms[0].results[0].result;
        await postRoll(roll, 'test', { // HDA
            label,
            target: token.actor.getRollData().STR,
            natural: rolled,
            success: roll.total !== 0,
        }, { token });
        html.querySelector(".roll-str-save").setAttribute('disabled', 'disabled')
    }
}

# Apuestas: análisis de la IA

La pestaña **Apuestas** (`#/apuestas`) muestra, para cada día de LaLiga o
Champions, las apuestas de bet365 que la IA considera más jugosas: las que
pagan más de lo que deberían. Es información: GalacticBet no gestiona
apuestas ni dinero.

## Cómo funciona

1. **Cuándo.** El workflow `AI betting analysis` se ejecuta cada diez
   minutos entre las 08:00 y las 22:00 UTC. Sale en segundos salvo que el
   primer partido aún por jugar de un día de LaLiga o Champions empiece en
   menos de 45 minutos. El análisis llega así entre 35 y 45 minutos antes. Si
   GitHub se salta esa ventana, se hace antes del siguiente partido de ese
   día. Hay un análisis por competición y día en hora de España
   (`PD-2026-11-28`).
2. **Cuotas.** OddsPapi (plan gratuito, 250 peticiones al mes). Cada análisis
   hace tres peticiones:
   - los partidos, para emparejar los nombres;
   - las cuotas de bet365;
   - las de Pinnacle (`pinnacle+30`), la casa de referencia, de las que se
     quita el margen para obtener la probabilidad justa.

   Mercados: 1X2, doble oportunidad, empate no válido, ambos marcan y más/menos
   de 1,5, 2,5 y 3,5 goles. La lista oficial de mercados se guarda un mes
   (`providerCache/oddspapiMarkets`). El consumo se cuenta en
   `providerBudgets/oddspapi`, con un tope interno de 220 peticiones al mes.
3. **Datos.** Se añaden la clasificación, la forma, los partidos en casa y
   fuera, los goles a favor y en contra, el porcentaje de partidos con ambos
   marcando y con más de 2,5 goles, los enfrentamientos previos y los
   goleadores.
4. **IA.** Claude Code se ejecuta sin interfaz con el plan de Claude del
   propietario (token de `claude setup-token`). Trabaja en una carpeta vacía,
   solo puede buscar en la web (bajas y alineaciones) y no ve ningún otro
   secreto del job. Devuelve un JSON validado con hasta 6 apuestas, como mucho
   2 por partido.
5. **Validación.** Solo se guardan apuestas sobre mercados que existen, con
   la cuota real de bet365 (nunca la de la IA) y con al menos un 2 % de
   valor según la estimación de la IA. El resultado se publica en
   `analysis/football`, un documento público de solo lectura que guarda los
   24 últimos análisis.

La app resuelve cada apuesta con el resultado oficial a 90 minutos y lleva
el historial a una unidad por apuesta, sin reescribir nada.

## Configurar

En GitHub → Settings → Secrets and variables → Actions → **Repository
secrets**:

| Secreto | Qué es |
| - | - |
| `BET365_ODDS_KEY` | La clave de tu cuenta de [OddsPapi](https://oddspapi.io) (también vale `ODDSPAPI_KEY`). |
| `CLAUDE_CODE_OAUTH_TOKEN` | Token de tu plan de Claude (Pro o superior). Créalo una vez en tu ordenador con `claude setup-token` (Claude Code instalado). Dura un año. |

Opcional, en **Variables**: `CLAUDE_MODEL` para elegir el modelo (si no, el
de tu plan por defecto). Cada análisis consume uso de tu plan como una
conversación normal de Claude Code; no se paga nada aparte.

## Probar

Actions → **AI betting analysis** → Run workflow con «Prueba» marcado: trae
las cuotas y los datos del próximo día de partidos y escribe en el registro
cuántos partidos se han emparejado y sus cuotas 1X2. No llama a la IA ni
guarda nada. Gasta 3 o 4 peticiones de OddsPapi.

Sin «Prueba», hace lo mismo que la tarea programada: solo genera el
análisis si toca.

## Juego responsable

La pestaña muestra siempre el aviso +18 y un enlace a jugarbien.es. Las
cuotas cambian: hay que comprobarlas en bet365.

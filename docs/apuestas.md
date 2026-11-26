# Apuestas: análisis de la IA

La pestaña **Apuestas** (`#/apuestas`) muestra, para cada día de LaLiga o
Champions, las apuestas de bet365 (u otra casa española si bet365 no está al
día) en las que la IA ve valor: las que pagan más de lo que deberían según su
probabilidad. Para cada partido da también una recomendación, todas sus cuotas
con su probabilidad y una etiqueta de confianza. Es información: GalacticBet
no gestiona apuestas ni dinero.

## Cómo funciona

1. **Cuándo.** El workflow `AI betting analysis` se ejecuta cada diez
   minutos entre las 08:00 y las 22:00 UTC. Sale en segundos salvo que el
   primer partido aún por jugar de un día de LaLiga o Champions empiece en
   menos de 45 minutos. El análisis llega así entre 35 y 45 minutos antes. Si
   GitHub se salta esa ventana, se hace antes del siguiente partido de ese
   día. Hay un análisis por competición y día en hora de España
   (`PD-2026-11-28`), y se hace una sola vez: cuenta como hecho desde 3 horas
   antes del primer partido del día, aunque ese partido ya haya empezado. Si
   un análisis se rehace (uno manual de mucho antes), los partidos que ya han
   empezado conservan lo que se publicó y siguen contando en el historial.
2. **Cuotas.** OddsPapi (plan gratuito, 250 peticiones al mes). Cada análisis
   hace una petición con los partidos del día (para emparejar los nombres) y
   otra por partido. Cada una de estas trae a la vez bet365, varias casas con
   licencia en España y Pinnacle (`pinnacle+30`), la casa de referencia, de la
   que se quita el margen para obtener la probabilidad justa. Un día de LaLiga
   gasta entre 2 y 5 peticiones; uno de Champions, unas 10.

   **bet365 primero.** OddsPapi no siempre tiene bet365 al día (en la prueba
   del 26/11/2026 solo lo estaba en 1 de 22 partidos de LaLiga, con cuotas de
   hacía una semana). Las cuotas de una casa que OddsPapi no está leyendo
   (`bookmakerIsActive: false`) o que tiene suspendida no se usan nunca. En ese
   caso se usa la primera casa española al día, en este orden: Winamax,
   888sport, bwin, Codere, LeoVegas, Golden Park, William Hill, Betway y
   Betsson. La app muestra la casa junto a cada cuota.

   Mercados: 1X2, doble oportunidad, empate no válido, ambos marcan y más/menos
   de 1,5, 2,5 y 3,5 goles, y de jugador: **goleador** (marca en cualquier
   momento) y **tarjeta a jugador**, de la misma casa que el resto del partido
   y en la misma petición (los 20 jugadores con la cuota más corta de cada
   uno). La lista oficial de mercados, con los de jugador, se guarda un mes
   (`providerCache/oddspapiMarkets`). El consumo se cuenta en
   `providerBudgets/oddspapi`, con un tope interno de 220 peticiones al mes.
3. **Datos.** Se añaden la clasificación, la forma, los partidos en casa y
   fuera, los goles a favor y en contra, el porcentaje de partidos con ambos
   marcando y con más de 2,5 goles, los enfrentamientos previos y los
   goleadores.
4. **IA.** Claude Code se ejecuta sin interfaz con el plan de Claude del
   propietario (token de `claude setup-token`). Trabaja en una carpeta vacía,
   solo puede buscar en la web (bajas y alineaciones, al menos una búsqueda por
   partido) y no ve ningún otro secreto del job. Devuelve un JSON validado con
   dos cosas:
   - **Apuestas con valor:** hasta 6 apuestas (como mucho 2 por partido) que pagan
     al menos un 3 % más de lo justo según su estimación. Con casas normales
     son pocas: suelen pagar entre un 5 y un 9 % menos que el precio justo de
     Pinnacle.
   - **La recomendación de cada partido**, siempre. Es la apuesta con más valor
     esperado entre las que tienen al menos un 40 % de probabilidad, aunque su
     valor sea negativo. La app muestra ese valor tal cual: «IA +4 %» o
     «IA sin valor (−3 %)».

   Se le pide vocabulario de análisis (valor, probabilidad, cuota, margen) y
   nada coloquial.
5. **Validación.** Solo se guardan apuestas sobre mercados que existen, con
   la cuota real de la casa (nunca la de la IA). Una apuesta con valor tiene que mostrar
   al menos «+3 %» de valor según la IA (redondeado: desde un 2,5 %) y la IA
   no puede darle más de 10 puntos por encima de la probabilidad justa de
   Pinnacle: más que eso es exceso de confianza, no valor. La recomendación de
   un partido necesita al menos un 40 % de probabilidad.

   **Apuestas de jugador.** Pinnacle no las cotiza: no hay valor «según el
   mercado». La referencia es la probabilidad de la propia cuota (1 / cuota,
   con el margen de la casa) y la IA no puede pasarla en más de 10 puntos.
   Como mucho 2 entre las apuestas con valor. El job las resuelve en cada pasada con el
   acta del partido de ESPN (`matchInsights`): marca o ve tarjeta, acertada;
   jugó y no, fallada; no jugó (ni titular ni entró), nula, como en las casas.
   Para dar por fallado un goleador hacen falta todos los goles del marcador
   en el acta; si el acta no se completa en una semana, la apuesta es nula.
   Los remates a puerta aún no: el acta solo trae estadísticas por equipo. La hora de las
   cuotas es la de su lectura, no la de la respuesta de la IA. El resultado se
   publica en `analysis/football`, un documento público de solo lectura con
   los 24 últimos análisis y, en `archive`, los totales de los anteriores.

## En la app

Lo importante se ve de un vistazo, con gráficas:

- **De un vistazo:** el valor de la recomendación de cada partido alrededor
  de cero, con el umbral de valor (+3 %). Tocar un partido lleva a su ficha
  dentro del análisis.
- **Confianza:** cada apuesta lleva «Confianza muy alta / alta / media / baja»
  con su porcentaje y de una a cuatro barras. Es la probabilidad de ganarla,
  con una escala fija: muy alta desde el 70 %, alta desde el 55 %, media desde
  el 40 % y baja por debajo. Se usa la estimación de la IA, nunca por encima
  de la del mercado (Pinnacle sin margen) cuando la hay. La solidez de los
  argumentos que da la IA es otra cosa y va en «Por qué y de dónde sale».
- **Cuotas del partido:** en cada partido, todas las opciones principales
  (1X2, doble oportunidad, empate no válido, ambos marcan y más/menos goles)
  con su cuota, su probabilidad sin margen, su confianza y su «Pago»: lo que
  paga la cuota frente a esa probabilidad (0 % sería lo justo; las casas
  suelen pagar algo menos, su margen). Ordenadas de más a menos probable, con
  la **mejor pagada** y la **recomendación** marcadas. Se guardan con el
  análisis (`matches[].options`).
- **¿Quién gana?:** las probabilidades de 1, X y 2 sin margen, de Pinnacle o,
  si no hay, de la casa.
- **Goles:** probabilidad de más de 2,5 goles y de que marquen los dos.
- **Forma:** los últimos cinco resultados de cada equipo.
- **¿Compensa?:** la probabilidad que da la IA frente a la que necesita la
  cuota para compensar (1 / cuota). Si la barra pasa la marca, paga de más.
  Un punto marca la del mercado (Pinnacle sin margen), cuando la hay.
- **Valor:** dos etiquetas, una al lado de la otra. «IA +5 %» es lo que paga
  la cuota según la estimación de la IA; «Mercado −3 %», según Pinnacle sin su
  margen. Así se ve enseguida cuándo el mercado no está de acuerdo.

El texto queda en segundo plano, plegado en «Por qué y de dónde sale»: la
previa, el motivo, el riesgo y el origen de cada dato (cuotas, casa y hora;
resultados oficiales; las webs que leyó la IA, solo el nombre del sitio y sin
enlace; la hora del análisis). Los colores de 1 · X · 2 (ámbar, gris y azul)
están validados para daltonismo en los dos temas y son los mismos en Ligas ›
Datos.

### Combinada

- **Combinada de valor.** Si un día hay apuestas con valor de al menos dos
  partidos, se forma sola con la mejor de cada partido (como mucho tres, la
  de más valor primero). Se fija al publicar el análisis
  (`analyses[].combo`, las claves de sus apuestas) y lleva su propio
  historial: gana si aciertan todas, pierde con una fallada; una nula cuenta a
  cuota 1, como en las casas.
- **Tu combinada.** «＋ Combinada» en cualquier apuesta del análisis la añade
  a la tuya; una de un partido que ya estaba ocupa su lugar (dos del mismo
  partido no se multiplican: están relacionadas y las casas las cotizan
  aparte). Un panel fijo enseña la cuota total y, al abrirlo, las apuestas, la
  probabilidad de acertarla según la IA y según el mercado, su valor y la
  gráfica «¿Compensa?». No se guarda: es una calculadora.
- Siempre con el mismo aviso: las cuotas se multiplican y el margen de la
  casa también; una combinada solo tiene valor si lo tiene cada apuesta, y se
  acierta pocas veces.

La app resuelve cada apuesta con el resultado oficial a 90 minutos y lleva
tres historiales a una unidad por apuesta, sin reescribir nada: el de las
apuestas con valor, el de la recomendación de cada partido y el de la
combinada de valor (una unidad por combinada, a su cuota total). Cuando un análisis sale del
documento (se guardan los 24 últimos), sus apuestas ya resueltas se suman a
los totales archivados de su competición: el historial no olvida ninguna e
indica desde cuándo cuenta.

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

Actions → **AI betting analysis** → Run workflow con el modo **prueba**: trae
las cuotas y los datos del próximo día de partidos y escribe en el registro
cuántos partidos se han emparejado, de qué casa son las cuotas y su 1X2. No
llama a la IA ni guarda nada. Gasta una petición más que el número de
partidos de ese día (dos la primera vez, para el catálogo de mercados).

También lista los **mercados de jugador** que da cada casa en cada partido
(goleador, remates a puerta…), cuántos jugadores tienen cuota, si la casa
está al día y qué campos trae cada cuota: las líneas «OddsPapi: … jugadores
en …». Salen de la misma respuesta que las cuotas del partido, sin gastar
peticiones aparte. Sirve para decidir qué mercados de jugador se pueden usar.

Con el modo **completo** genera y publica ya el análisis del próximo día de
partidos, aunque falte mucho. El análisis automático de 45 minutos antes lo
sustituye después con cuotas y alineaciones más frescas: un análisis hecho
más de 3 horas antes del primer partido no cuenta como hecho.

## Juego responsable

La pestaña muestra siempre el aviso +18 y un enlace a jugarbien.es. Las
cuotas cambian: hay que comprobarlas en bet365.

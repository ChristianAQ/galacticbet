# Ligas

La ruta principal es `/ligas`, con pestañas `partidos`, `clasificacion`, `noticias` y `estadisticas` en el parámetro `tab`. `/partidos` redirige conservando competición, temporada y jornada. Los enlaces internos y la navegación lateral/inferior usan Ligas. Las cuatro pestañas comparten competición y temporada; los cambios no recargan la página. El menú ocupa el ancho disponible y mide la altura de la cabecera fija, incluida el área segura del iPhone. Al quedar fijado reduce la fila de ligas a los tres logos, manteniendo siempre visibles y accesibles las cuatro pestañas. Recupera los nombres y el tamaño original solo al volver al inicio de la navegación, como el panel de guardado de quiniela. Un observador de intersección sobre un origen estable evita cambios de tamaño al invertir el sentido del scroll, enfocar o cambiar de pestaña. La cabecera de clasificación refuerza su fondo opaco, contraste y sombra al quedar fijada debajo del menú. El indicador y el contenido se desplazan lateralmente según el orden de las pestañas, respetando movimiento reducido. Se elimina la cabecera visual y el selector de temporada; se conserva la resolución de temporadas desde enlaces y se usa la más reciente por defecto.

## Datos y temporada

- **Partidos:** reutiliza tarjetas, jornadas, fichas y el criterio de jornada actual. La temporada se filtra antes de elegir jornadas o mostrar resultados. Un enlace a una jornada histórica permite resolver su temporada si no hay una temporada explícita.
- **Clasificación:** `CompetitionTable` reutiliza `LeagueTable`, compartida con la nueva ficha de partido, en su modalidad de columnas completas. Reutiliza los resultados normalizados y muestra PJ, V, E, D, goles a favor/en contra en una sola columna +/− (20-10), DG y puntos, con equipos a cero cuando ya están en el calendario. Las columnas compactas caben sin desplazamiento lateral desde 320 px; los nombres largos se truncan visualmente conservando el nombre accesible. La cabecera permanece fija debajo de la navegación y sigue su reducción. La tabla compacta de la ficha de partido conserva sus columnas anteriores. Se usa solo la fase liga de la competición y temporada elegidas, sin mezclar eliminatorias. El orden por puntos/diferencia/goles es una clasificación calculada: no sustituye los desempates particulares ni sanciones del organizador. La interfaz lo indica.
- **Noticias:** conserva `news/football` y sus seis titulares generales para Inicio. Añade hasta seis titulares por competición en `competitionArticles`, de manera que una competición no desplace los de las otras. La app filtra competición, temporada deportiva julio–junio y antigüedad máxima de siete días; ordena por fecha descendente. No muestra noticias actuales al elegir una temporada histórica. La caché local es de una hora (ausencias dos minutos), sin consultas por pestaña o competición adicionales al mismo feed.
- **Datos:** solo cifras comprobables, con dos fuentes:
  - Las cifras de la temporada y las tablas de equipos se calculan en la app con los resultados oficiales (`seasonFigures.ts`): partidos jugados de los programados, goles y media por partido, «ambos marcan», «más de 2,5 goles» y el reparto 1 · X · 2.
  - Los goleadores vienen de Football-Data, el mismo proveedor que los resultados.

  Las tablas de equipos son top 5 de más goleadores, menos goleados, porterías a cero, mejor local y mejor visitante (puntos en casa y fuera). Cuentan los partidos con resultado oficial a 90 minutos de la competición y temporada elegidas, eliminatorias incluidas; un partido en juego no cuenta. «Menos goleados» ordena por goles recibidos por partido entre los equipos con al menos la mitad de partidos que el que más ha jugado, para que un eliminado pronto no lo encabece. Los empates comparten posición.

## Goleadores

`leagueStats/{PD|CL|PL}-{año}` (versión 2) guarda hasta 20 goleadores: nombre, club (nombre corto), escudo, goles, asistencias, penaltis y partidos jugados. Asistencias y penaltis son `null` cuando el proveedor no los publica: nunca se interpretan como cero. Se exige que la temporada y la competición de la respuesta coincidan con las mostradas. Un jugador repetido no se cuenta dos veces. La pestaña muestra los 10 primeros con «Ver los 20», la fuente y cuándo se actualizó. Una visita lee un solo documento, con caché compartida de quince minutos.

La versión 1 (rankings de SportAPI) ya no se lee. Tenía listas parciales: tarjetas recortadas a cien registros, participación en goles solo de quien salía en ambas listas, y minutos y porterías a cero sin ranking disponible. Por eso se veían huecos y cifras que no cuadraban.

## Sincronización y consumo

`scripts/syncLeagueStats.ts` se ejecuta desde `scripts/officialSync.ts`, después de los calendarios y con el mismo `FOOTBALL_DATA_TOKEN`. Consulta `/competitions/{code}/scorers?season={año}&limit=20`:

- Una sola petición por ejecución: la de la competición cuya edición es más antigua.
- Cada competición se renueva como mucho cada seis horas.
- No consulta antes del primer resultado de la temporada.

Un error, una cuota agotada o una temporada no verificable conservan la edición anterior. Los resultados oficiales nunca esperan a este paso.

Firestore permite solo obtener documentos públicos de temporada con IDs válidos; el cliente no puede listar la colección ni escribir estadísticas. `scorers` y los titulares por competición no se indexan. La publicación de reglas e índices va incluida en Deploy frontend. Tras publicar, los goleadores aparecen con las siguientes ejecuciones de Synchronize football and standings (una competición por ejecución). No hacen falta secretos nuevos.

## Competiciones entre amigos: ficha y acta

Cada partido de una liga propia tiene su página, `#/competicion/{id}/partido/{partido}`, con la misma cabecera, pestañas y piezas que la ficha oficial: marcador, goleadores, forma, fecha y lugar; **Previa** (antes del inicio), **Eventos**, **Alineaciones**, **Pronósticos** y **Clasificación** cuando hay datos. Se abre desde Ligas, la Quiniela y Gestión, con la misma animación de escudos y un solo paso atrás.

Organización (propietario y administradores) tiene en la cabecera **Resultado** (estado, marcador con botones +/−, fecha, lugar, confirmar o borrar), **Evento** y **Alineación**:

- **Evento:** gol (normal, penalti, en propia), tarjeta (amarilla, segunda amarilla, roja) o cambio. Equipo, minuto (+ añadido) y jugador de la plantilla o escrito a mano; asistencia o quién sale, opcional. Se propone el minuto del reloj si se juega. «Guardar y otro» deja la hoja lista para el siguiente. Tocar un evento de la línea de tiempo lo corrige o lo borra.
- **Marcador:** un gol nuevo sube su marcador salvo que el resultado ya lo contara (goleadores añadidos a un resultado puesto a mano); borrar un gol lo baja solo si el marcador eran exactamente los goles anotados. Anotar en un partido sin empezar lo pone en juego desde 0–0. La hoja muestra el efecto antes de guardar.
- **Alineación:** titulares y suplentes de cada plantilla, «Repetir la del último partido» y alta rápida de jugadores. Se dibuja sobre el campo por posiciones (POR, DEF, MED, DEL), sin necesidad de once jugadores.
- **Plantillas:** en Gestión › participante, línea a línea (dorsal, nombre, posición) o pegando una lista («10 Pedro Ruiz DEL»).

Con actas anotadas, Ligas añade **Estadísticas**: goleadores, asistencias y tarjetas. Las reglas solo dejan escribir plantillas (hasta 60 jugadores) y actas (hasta 150 eventos, 40 por alineación) a la organización; el resto se valida al leer. Sin cobertura, el cambio se ve al momento y se envía al volver la red, mientras la app siga abierta.

## Compartir

Se retira «Copiar texto» de `ShareDialog`, el menú compartido de quinielas y clasificaciones. Se conserva la vista previa PNG, Compartir nativo y Descargar. Sin compartir nativo se indica que se descargue la imagen, sin copiar automáticamente al portapapeles. Las opciones de la hoja del sistema dependen de iOS/Android. La herramienta de porras y la copia de invitaciones conservan su funcionamiento.

## Comprobaciones

Pruebas unitarias: filtros por liga/temporada, tabla, goleadores oficiales y cifras de la temporada, cuotas, rechazo de temporadas incorrectas, caché, noticias y conservación ante fallos. El emulador verifica acceso público por ID y denegación de listados/escrituras. El navegador comprueba 320–1440 px, sticky bajo la cabecera móvil, todas las columnas de clasificación, aislamiento de temporadas, carga/vacío/error/reintento, teclado, enlaces antiguos y compartir únicamente imagen.

## Quiniela de una liga propia

Igual que la de LaLiga: los signos son un borrador privado hasta pulsar **Sellar boleto**, que pide todos los partidos de la jornada y confirma antes de guardar. La jornada cierra en su primer partido. Un boleto sellado no se puede cambiar ni borrar. Los boletos de los demás se ven al sellar el tuyo o, para todos, al cerrarse la jornada. Los borradores no se ven nunca. Solo puntúan los boletos sellados: Clasificación, el tablero de la jornada y la pestaña Pronósticos del partido los leen, y los puntos se calculan siempre con los resultados.

- `customCompetitions/{id}/rounds/{J1|G1|A1|FINAL…}`: plazo (`deadline`, el primer partido) y `matchIds` (partidos ni aplazados ni cancelados, con los dos rivales conocidos). Los escribe la app de la organización al abrir Ligas, la ficha o la Quiniela, cuando cambian fechas, resultados o cruces. Una jornada cerrada no se vuelve a tocar.
- `…/rounds/{jornada}/entries/{uid}`: el boleto sellado (`matchIds`, `selections`, `mode`), en el mismo formato que los de los grupos. Las reglas comprueban plazo, partidos, modo y que esté completo.
- `…/roundAttendance/{jornada}`: quién ha sellado (nunca qué), para «Faltáis 2, tú incluido».

## Elección compartida y lista de ligas

La liga elegida en Ligas o en Quiniela (boleto o clasificación), ya sea oficial o propia, es una sola elección. Se guarda en las preferencias de la cuenta en el dispositivo (`competition` y `liga`). Un enlace (`?liga=` o `?competition=`) la cambia. Una pestaña que vuelve a mostrarse con una URL anterior sigue la elección más reciente en vez de deshacerla. En Quiniela y Clasificación solo se muestran las ligas propias que sigues y que tienen quiniela. Sin grupo, abren la primera, porque las oficiales necesitan un grupo.

En la fila de escudos solo aparecen LaLiga, Champions, Premier y las ligas que sigues. Las ligas creadas por otros no aparecen hasta que las sigues. Ya no se guardan ligas «recientes» en el dispositivo. Una liga abierta desde un enlace sin seguirla se muestra mientras la estás viendo. La próxima vez que abras Ligas ya no está. También se quita con «Quitar de la lista», en su cabecera, o manteniendo pulsado su escudo. Dejar de seguir una liga también la quita de la lista.

Al iniciar sesión desde la ventana de acceso, la app abre Inicio. Una sesión que se recupera al abrir la app no cambia de pantalla.

## Visibilidad y búsqueda de ligas

Cada liga propia es privada o pública (`visibility`; sin el campo, privada):

- **Privada**: no sale en la búsqueda; solo se entra con el código, el enlace o el QR.
- **Pública**: cualquiera con cuenta la encuentra y la sigue.

Se elige al crearla («Visibilidad») y el propietario la cambia en Gestión › Ajustes.

La lupa a la derecha del título grande de Ligas abre «Buscar ligas»:

- Sin texto, lista ligas públicas, primero las más seguidas.
- Al escribir, busca por el principio de cualquier palabra del nombre o del deporte, sin tildes ni mayúsculas.
- «Seguir» añade la liga a tu lista sin cerrar la hoja; tocar el resto de la fila la abre.

Para buscar, cada liga guarda `searchTerms`: los prefijos de las palabras de su nombre y deporte, como máximo 15 letras por palabra y 120 términos. La consulta es `visibility == "public"` más `searchTerms array-contains <palabra más larga>`, con su índice en `firestore.indexes.json`. El resto de palabras se filtra en el cliente. Las reglas solo dejan listar las ligas que sigues o las públicas, nunca las privadas de otros.

## Fila de escudos

Los escudos (`CompetitionTabs`) son píldoras sobre la cabecera oscura, con los bordes que se desvanecen al desplazar la fila. Un único resaltado amarillo marca la elegida:

- El resaltado se desliza y estira de un escudo a otro con un muelle.
- La fila se desplaza suavemente para centrar la elegida.
- Al volver a mostrarse (otra pestaña, atrás), se coloca sin animar.
- Las ligas propias que entran en la fila aparecen con una pequeña escala.
- «＋ Nueva» es una píldora vacía con borde.

Con movimiento reducido no hay deslizamiento.

## Quiniela: boleto y clasificación en una pestaña

La barra inferior tiene tres opciones: Inicio, Ligas y Quiniela. La cabecera de Quiniela es común a las dos vistas y no se mueve al cambiar de una a otra:

- El título es el grupo seleccionado («Los del barrio ⌄»). Al tocarlo se abre el selector del sistema para cambiar de grupo. Con una liga propia elegida, el título es la liga.
- Debajo van las competiciones a elegir: LaLiga, Champions, Premier y tus ligas propias, igual que en Ligas. Solo están activas las que juega el grupo; si el grupo no juega la elegida, se elige la primera que sí juega. «Todas» aparece en la clasificación total.
- El antetítulo indica el modo («Quiniela · 1X2», «Liga propia · Marcador exacto»).

Debajo, «Mi boleto | Clasificación» es el mismo control fijo de Ligas: se queda bajo la barra al bajar, y el panel de «Sellar boleto» se fija justo debajo. Al cambiar de vista, el contenido se desliza hacia el lado de la pestaña elegida; si estabas muy abajo, la nueva vista empieza bajo el control. La vista va en `?vista=clasificacion`, la jornada en `?round=` (común a las dos vistas) y «Jornada/Total» en `?period=all` (con `?todas=1` para todas las competiciones). Los enlaces antiguos a `#/clasificacion` (avisos, accesos directos) redirigen a la vista de clasificación con sus parámetros.

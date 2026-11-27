# Inicio: «La IA te cuenta»

En Inicio, bajo «Próximo saque», la IA hace una pequeña portada: lo que se
viene, los partidos que merece la pena seguir y las noticias que merece la
pena leer. Es información: no habla de apuestas ni de cuotas.

## Qué se ve

- **Titular y resumen** de lo que se viene (2 o 3 frases).
- **Partidos clave:** hasta 4 de los próximos días. Cada uno con lo que está
  en juego («Duelo por el liderato»), una previa con datos (puestos, puntos,
  forma, goles, enfrentamientos) y «Qué vigilar». Al tocarlo se abre la
  ficha del partido. Siguen el calendario de la app: si el partido cambia de
  hora se ve la nueva, en juego muestra el marcador, y desaparece 2 horas
  después del saque o si se aplaza.
- **Para leer:** de 3 a 5 titulares de ESPN, variados, con una frase de la
  IA sobre por qué merece la pena cada uno. Se abren en ESPN.
- Al pie, la ficha: «Elegido y escrito por IA», el modelo, si buscó en la
  web y la hora.

Si la portada tiene más de 36 horas, no se muestra: hablaría de días ya
pasados. Sin portada publicada (o en el modo demo), la sección no aparece.

## Cómo funciona

El workflow **AI front page** (`.github/workflows/briefing.yml`,
`npm run briefing`) se lanza a las 7:45, 13:45 y 18:45 (hora de España). Si
la portada publicada tiene menos de 3 horas no hace nada, así que un horario
repetido no gasta la IA, y uno retrasado un par de horas no hace saltarse el
siguiente.

1. **Partidos:** los que aún no han empezado de los próximos 4 días (si hay
   menos de 3, los de las próximas 2 semanas: un parón), como mucho 30. De
   cada uno, lo mismo que lee el análisis de apuestas sin las cuotas:
   clasificación, forma, partidos en casa y fuera, goles, porcentajes de
   «ambos marcan» y «más de 2,5», goleadores y enfrentamientos previos.
   También los resultados de los últimos 2 días.
2. **Noticias:** los titulares de ESPN que guarda la sincronización
   (`news/football`, todas las competiciones) de los últimos 4 días, sin
   repetir, como mucho 18.
3. **IA:** la misma que en Apuestas y en el mismo orden: Claude con el plan
   (`CLAUDE_CODE_OAUTH_TOKEN`; puede hacer como mucho 4 búsquedas web para
   confirmar bajas) y, si falla, Gemini gratis (`GEMINI_API_KEY`, sin
   búsqueda web). `ANALYSIS_AI=gemini` pone Gemini primero.
4. **Validación:** solo se aceptan partidos de la lista y enlaces de la
   lista de ESPN, cada uno una vez. El equipo, el escudo, la hora, el título,
   la foto y el enlace se copian de nuestros datos, nunca de la IA. Los
   textos se recortan a los límites de la app. Si no queda ningún partido ni
   noticia, la respuesta se descarta.
5. Se publica en `briefing/football`, un documento público de solo lectura
   (solo lo escribe el backend). Si la IA falla, se conserva la portada
   anterior y el job termina en error para que se vea en Actions.

La app lo lee como mucho cada 10 minutos (y al tirar para actualizar).

## Probar

Actions → **AI front page** → Run workflow:

- **prueba:** genera la portada con la IA y la escribe en el registro, sin
  guardar nada.
- **completo:** genera y publica una nueva ya, aunque la actual sea reciente.

En «ia» se elige qué IA va primero.

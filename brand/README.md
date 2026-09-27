# book. — marca

Aprobada el 2026-09-27 (dirección F, variante 1B + punto violet 500). Fuente de verdad de
todo lo que lleve la marca: la web y la app Android (y iOS cuando llegue) exportan desde acá.

## Archivos

| Archivo | Uso |
|---|---|
| `wordmark.svg` | Logo principal sobre fondos claros (sidebar, login) |
| `wordmark-reverse.svg` | Sobre fondos oscuros (splash, modo oscuro de la app) |
| `wordmark-mono-ink.svg` / `wordmark-mono-paper.svg` | Un solo color: PDFs en blanco y negro, sellos, marcas de agua |
| `icon.svg` | Ícono redondeado: favicon y `app/icon.svg` de la web |
| `icon-square.svg` · `png/icon-1024.png` | Cuadrado a sangre, sin transparencia: iOS (la máscara la pone el sistema) y Android legacy |
| `android-foreground.svg` · `png/android-foreground-1024.png` | Ícono adaptativo de Android, capa frontal. Fondo: `#18181B` |
| `android-monochrome.svg` · `png/android-monochrome-1024.png` | Íconos temáticos de Android 13+ |
| `notification.svg` · `png/notification-96.png` | Ícono de notificación: silueta blanca, obligatoria en Android |
| `png/splash-icon-1024.png` | Splash de la app, sobre `#0C0C0E` |

## Construcción

- Letras: contornos de **Bricolage Grotesque**, peso 800, tamaño óptico 96, convertidos a
  trazos. Licencia SIL Open Font License; los archivos no dependen de la fuente instalada.
- Espaciado entre letras: −50 unidades (sobre 1000 por em).
- **La “b”**: el asta termina con un corte a 45° de 100 unidades, como la esquina doblada de una
  página. Es lo que la hace propia; no quitarlo.
- **El punto**: círculo exacto de 180 unidades de diámetro (el asta mide 162), apoyado en la línea
  base con 14 unidades de exceso, igual que las “o”.
- Ícono adaptativo: el “b.” ocupa el 58 % de la zona visible y entra en el círculo seguro de 66 dp.

## Color

| | Hex | Nota |
|---|---|---|
| Ink | `#18181B` | Texto del wordmark y fondo del ícono |
| Paper | `#FAFAFA` | Wordmark invertido y “b” del ícono |
| Dot | `#8B5CF6` | Violet 500. Contraste 4,2:1 sobre blanco y 4,6:1 sobre `#0C0C0E` |

## Uso

- Aire mínimo alrededor: el diámetro del punto, por lado.
- Wordmark: no menos de 64 px de ancho. Ícono: hasta 16 px.
- El punto solo es violeta, Ink o Paper (estos dos, en versiones de un color). Nunca otro color.
- No estirar, no rotar, no agregar sombras ni contornos, no recomponer las letras.

## Regenerar

`source/` tiene lo necesario para reproducir los SVG sin redibujar nada:

- `glyphs.json`: los contornos de “b”, “o”, “k” y “.” ya extraídos de la fuente.
- `build.py` y `kit.py`: arman wordmarks e íconos desde esos contornos
  (`python kit.py` escribe los SVG). `extract.py` muestra cómo se obtuvo `glyphs.json` a partir
  de la fuente variable (con fontTools; la fuente no se guarda en el repo).
- `OFL.txt`: la licencia de Bricolage Grotesque, porque los contornos derivan de ella.

Para un tamaño nuevo de PNG, exportar desde el SVG correspondiente.

# Local Setup - Windows 24/7

Este bot corre localmente en modo simulacion. No usa wallet, claves privadas ni trading real.

## 1. Instalar Node.js

1. Descarga Node.js LTS desde https://nodejs.org/
2. Instala con las opciones por defecto.
3. Abre PowerShell y valida:

```powershell
node --version
npm --version
```

## 2. Instalar dependencias

Desde la carpeta del proyecto:

```powershell
npm install
```

## 3. Configurar variables

Copia `.env.example` a `.env` si todavia no existe.

Valores obligatorios de seguridad:

```env
APP_MODE=SIMULATION_ONLY
ENABLE_REAL_TRADING=false
```

## 4. Correr migraciones Prisma

```powershell
npm run prisma:migrate
```

Si solo quieres regenerar el cliente Prisma:

```powershell
npm run prisma:generate
```

## 5. Compilar

```powershell
npm run build
```

## 6. Iniciar con PM2

PM2 esta instalado como dependencia del proyecto. Usa:

```powershell
npm run pm2:start
npm run pm2:save
```

Comandos utiles:

```powershell
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
```

## 7. Evitar suspension de Windows

Para correr 24/7:

1. Abre Configuracion de Windows.
2. Ve a Sistema > Energia.
3. Cambia suspension a "Nunca" cuando este conectado.
4. Si usas laptop, mantenla conectada.
5. Revisa que Windows Update no reinicie el equipo en horario activo.

Opcional desde PowerShell como administrador:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

## 8. Revisar logs

Logs del bot:

```text
logs/YYYY-MM-DD.log
```

Logs PM2:

```text
logs/pm2-out.log
logs/pm2-error.log
logs/pm2-combined.log
```

Reportes:

```text
logs/reports/YYYY-MM-DD-report.txt
```

Ver logs en vivo:

```powershell
npm run pm2:logs
```

## 9. Health check interno

El bot escribe un health check en logs con:

- modo actual
- estado DB
- ultimo snapshot
- ultima prediccion
- ultimo error
- operaciones pendientes
- operaciones resueltas

Busca lineas con:

```text
Health check
```

## 10. Restaurar backup SQLite

Los backups se guardan en:

```text
backups/dev-YYYYMMDD-HHmmss.db
```

Para restaurar:

1. Deten el bot:

```powershell
npm run pm2:stop
```

2. Copia el backup elegido sobre la base activa:

```powershell
Copy-Item .\backups\dev-YYYYMMDD-HHmmss.db .\prisma\dev.db -Force
```

3. Inicia de nuevo:

```powershell
npm run pm2:start
```

## 11. Reportes

Reporte diario y acumulado:

```powershell
npm run report
```

Export dataset futuro ML:

```powershell
npm run export:ml-dataset
```

Si no hay suficientes operaciones resueltas, el exportador mostrara:

```text
No hay suficientes datos para ML. Minimo recomendado: 1000 operaciones resueltas.
```

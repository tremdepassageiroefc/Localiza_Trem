# EFC — App "A bordo" (GPS do celular)

Versão só do modo **A bordo**: sem simulação e sem modo Remoto. Usa o GPS real do
celular, com os botões **Automático**, **P-21** e **P-22**. Depois da primeira
abertura com internet, funciona sem internet.

## Por que precisa de um endereço https
O celular só libera o GPS e a instalação do app em páginas **https** (ou
`localhost`). Abrir o arquivo `index.html` direto no celular, ou por um
endereço `http://192.168...`, **não** funciona para isso. Então esta pasta precisa
ficar hospedada uma vez num endereço https (grátis). Opções:

1. **Netlify (arrastar e soltar):** entre em app.netlify.com/drop e arraste esta
   pasta inteira. Ele devolve um endereço https.
2. **GitHub Pages:** crie um repositório, envie os arquivos desta pasta e ative
   Settings > Pages.
3. **Firebase Hosting** (você já tem projeto Firebase): na pasta, rode
   `firebase init hosting` (pasta pública = esta pasta; não reescrever tudo para
   index.html) e depois `firebase deploy`.

(Os passos de cada serviço podem mudar; confira na página deles.)

## Instalar no celular
- **Android (Chrome):** abra o endereço https > menu ⋮ > **Instalar app** (ou
  "Adicionar à tela inicial").
- **iPhone (Safari):** abra o endereço > botão Compartilhar > **Adicionar à Tela
  de Início**.

Na primeira vez, abra com internet e toque em **Iniciar**, autorizando a
localização. Depois disso o app abre e funciona sem internet.

## Uso a bordo
- Escolha **Automático** (decide pelo dia: seg/qui/sáb = P-21, ter/sex/dom =
  P-22), **P-21** (Anjo da Guarda → Parauapebas) ou **P-22** (Parauapebas →
  Anjo da Guarda) e toque em **Iniciar**.
- Deixe o app aberto e a tela ligada (o app pede para a tela não apagar). Se o
  celular bloquear a tela, o GPS pode parar de atualizar.
- O botão **Reiniciar** recomeça a viagem (zera horários e escolha).

## Atualizar o app
Ao trocar os arquivos na hospedagem, aumente o número em `CACHE` no `sw.js`
(ex.: `efc-bordo-v2`) para os celulares pegarem a versão nova.

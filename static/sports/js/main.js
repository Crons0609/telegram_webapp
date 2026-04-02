// ======================================================
// GHOSTH PLAGUE CASINO - FRONTEND SPORTSBOOK
// ======================================================

let currentBalance = 0
let currentUsername = ""
let currentChatId = ""

// DOM
const usernameInput = document.getElementById("username")
const chatIdInput = document.getElementById("chat_id")
const balanceElements = document.querySelectorAll("#balance")
const matchesContainer = document.getElementById("matches-container")
const notificationDiv = document.getElementById("notification")

const betSound = document.getElementById("bet-sound")
const winSound = document.getElementById("win-sound")

// ======================================================
// INIT
// ======================================================

function init() {

loadUser()

loadMatches()

setupEvents()

}

// ======================================================
// USER SESSION
// ======================================================

function loadUser(){

const savedUser = localStorage.getItem("username")
const savedChat = localStorage.getItem("chat_id")

if(savedUser){
usernameInput.value = savedUser
currentUsername = savedUser
}

if(savedChat){
chatIdInput.value = savedChat
currentChatId = savedChat
}

updateBalance()

}

function saveUser(){

const username = usernameInput.value.trim()
const chatId = chatIdInput.value.trim()

if(!username || !chatId){
showNotification("Completa usuario y chat id","error")
return
}

localStorage.setItem("username",username)
localStorage.setItem("chat_id",chatId)

currentUsername = username
currentChatId = chatId

showNotification("Usuario guardado","success")

updateBalance()

}

// ======================================================
// LOAD MATCHES
// ======================================================

async function loadMatches(){

showLoader()

try{

const res = await fetch("/api/matches")

const matches = await res.json()

renderMatches(matches)

}catch(e){

showNotification("Error cargando partidos","error")

}

}

function showLoader(){

matchesContainer.innerHTML = `
<div class="loader">
Cargando partidos...
</div>
`

}

// ======================================================
// RENDER MATCHES
// ======================================================

function renderMatches(matches){

matchesContainer.innerHTML = ""

matches.forEach(match => {

const card = document.createElement("div")

card.className = "match-card glass"

card.dataset.id = match.id

card.innerHTML = `

<div class="match-teams">

<div class="team">${match.team1}</div>

<div class="vs">VS</div>

<div class="team">${match.team2}</div>

</div>

<div class="match-date">

${formatDate(match.date)}

</div>

<div class="bet-options">

<div class="bet-option" data-choice="1">${match.team1}</div>

<div class="bet-option" data-choice="X">Empate</div>

<div class="bet-option" data-choice="2">${match.team2}</div>

</div>

<div class="bet-input">

<input type="number" placeholder="Cantidad" min="1" class="bet-amount">

<button class="place-bet">Apostar</button>

</div>
`

// seleccionar opcion

const options = card.querySelectorAll(".bet-option")

options.forEach(opt => {

opt.addEventListener("click",()=>{

options.forEach(o=>o.classList.remove("selected"))

opt.classList.add("selected")

})

})

// apostar

card.querySelector(".place-bet")
.addEventListener("click",()=>placeBet(card,match.id))

matchesContainer.appendChild(card)

})

}

// ======================================================
// PLACE BET
// ======================================================

async function placeBet(card,matchId){

const selected = card.querySelector(".bet-option.selected")

if(!selected){

showNotification("Selecciona un resultado","error")
return

}

const amountInput = card.querySelector(".bet-amount")

const amount = parseInt(amountInput.value)

if(!amount || amount<=0){

showNotification("Cantidad inválida","error")
return

}

if(!currentUsername || !currentChatId){

showNotification("Guarda tu usuario primero","error")
return

}

const teamChoice = selected.dataset.choice

try{

const res = await fetch("/api/bet",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({

username:currentUsername,
chat_id:currentChatId,
match_id:matchId,
team_choice:teamChoice,
amount:amount

})

})

const data = await res.json()

if(data.error){

showNotification(data.error,"error")
return

}

// sonido

if(betSound) betSound.play().catch(()=>{})

showNotification("Apuesta realizada","success")

animateCard(card)

updateBalanceDisplay(data.new_balance)

saveBetHistory(matchId,teamChoice,amount)

}catch(e){

showNotification("Error apostando","error")

}

}

// ======================================================
// BALANCE
// ======================================================

async function updateBalance(){

if(!currentUsername) return

try{

const res = await fetch(`/api/balance/${currentUsername}`)

const data = await res.json()

updateBalanceDisplay(data.balance)

}catch(e){}

}

function updateBalanceDisplay(balance){

currentBalance = balance

balanceElements.forEach(el=>{
el.textContent = balance
})

animateBalance()

}

// ======================================================
// ANIMATIONS
// ======================================================

function animateCard(card){

card.style.transform="scale(0.95)"

setTimeout(()=>{

card.style.transform=""

},200)

}

function animateBalance(){

balanceElements.forEach(el=>{

el.style.transform="scale(1.2)"

setTimeout(()=>{
el.style.transform="scale(1)"
},200)

})

}

// ======================================================
// BET HISTORY
// ======================================================

function saveBetHistory(matchId,teamChoice,amount){

let history = JSON.parse(localStorage.getItem("bets") || "[]")

history.unshift({

matchId,
teamChoice,
amount,
date:Date.now()

})

localStorage.setItem("bets",JSON.stringify(history))

}

// ======================================================
// NOTIFICATIONS
// ======================================================

function showNotification(msg,type="info"){

const notif = document.createElement("div")

notif.className=`notification ${type}`

notif.textContent = msg

notificationDiv.appendChild(notif)

setTimeout(()=>{

notif.remove()

},3000)

}

// ======================================================
// UTILS
// ======================================================

function formatDate(date){

const d = new Date(date)

return d.toLocaleString()

}

// ======================================================
// EVENTS
// ======================================================

function setupEvents(){

const saveBtn = document.getElementById("saveUser")

if(saveBtn){

saveBtn.addEventListener("click",saveUser)

}

usernameInput.addEventListener("change",saveUser)

chatIdInput.addEventListener("change",saveUser)

}

// ======================================================
// START
// ======================================================

init()
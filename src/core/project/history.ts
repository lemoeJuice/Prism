export interface HistoryCommand<T> { label:string; before:T; after:T }
export class CommandHistory<T> {
  private undoStack:HistoryCommand<T>[]=[]
  private redoStack:HistoryCommand<T>[]=[]
  constructor(private currentValue:T,private readonly clone:(value:T)=>T=(value=>structuredClone(value))){}
  get current(){return this.clone(this.currentValue)}
  get canUndo(){return this.undoStack.length>0}
  get canRedo(){return this.redoStack.length>0}
  get undoLabel(){return this.undoStack.at(-1)?.label}
  get redoLabel(){return this.redoStack.at(-1)?.label}
  execute(label:string,reduce:(current:T)=>T){
    const before=this.clone(this.currentValue),after=this.clone(reduce(this.clone(this.currentValue)))
    this.undoStack.push({label,before,after});this.redoStack=[];this.currentValue=after
    return this.current
  }
  replace(label:string,next:T){return this.execute(label,()=>next)}
  undo(){const command=this.undoStack.pop();if(!command)return this.current;this.redoStack.push(command);this.currentValue=this.clone(command.before);return this.current}
  redo(){const command=this.redoStack.pop();if(!command)return this.current;this.undoStack.push(command);this.currentValue=this.clone(command.after);return this.current}
}
